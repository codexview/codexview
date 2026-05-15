// Adapter: convert raw Codex rollout JSONL or AgentWeb events.jsonl
// into CodexView's ChatStreamEvent[] union for live demos.
//
// Two source formats are supported:
//   1) Codex CLI rollout files (~/.codex/sessions/.../rollout-*.jsonl)
//      Lines have shape { timestamp, type: 'session_meta'|'event_msg'|'response_item'|...,
//                          payload: {...} }
//   2) AgentWeb codex-team status logs (~/Projects/agentweb/.codex-team/runs/*/events.jsonl)
//      Lines have shape { at, event, status, payload }
//
// The adapter is intentionally lenient: anything it doesn't recognise becomes
// a `raw` event so the transcript still renders something rather than crashing.

const epoch = (iso) => {
  if (typeof iso === 'number') return iso;
  if (typeof iso !== 'string') return Date.now();
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
};

const tryParseJson = (s) => {
  if (s == null || typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
};

// Pull text out of OpenAI-style content arrays:
//   [{type:'input_text', text:'...'}, {type:'output_text', text:'...'}, ...]
const extractContentText = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') return c.text ?? '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

const detectFormat = (lines) => {
  for (const line of lines) {
    if (line && typeof line === 'object') {
      // Claude Code: every line carries `sessionId` (queue-operation, system, last-prompt,
      // user, assistant, attachment, ...). Codex rollout and codex-team logs do not.
      if ('sessionId' in line) return 'claude-code';
      // Codex rollout
      if ('type' in line && ('payload' in line || 'timestamp' in line)) return 'rollout';
      // AgentWeb codex-team status log
      if ('event' in line && 'at' in line) return 'codex-team';
    }
  }
  return 'unknown';
};

// Adapter for Codex CLI rollout JSONL format.
function adaptRollout(lines) {
  const out = [];
  let currentTurnId = null;
  let threadStarted = false;
  let pendingTokenCount = null;
  let synth = 0;
  // Track callIds already emitted as a "begin"-style event in the current turn,
  // so that synthesised begin events from event_msg/*_end don't collide with
  // the real ones already emitted from response_item/*_call.
  let openCalls = new Set();
  // Codex rollouts double-write each model message:
  //   1) event_msg/agent_message (or user_message) — streaming-protocol signal
  //   2) response_item/message[role=assistant|user] — Responses API "final" item
  // Both arrive ~1ms apart and both lack a stable id (message_id/id are usually null),
  // so the reducer's itemId-based dedup misses them. Track a turn-scoped fingerprint
  // of (role + text) and skip the second arrival.
  let seenMessages = new Set();
  // Same dual-write pattern for web_search:
  //   1) event_msg/web_search_end — has the real call_id and the result list
  //   2) response_item/web_search_call — has the query but id=null
  // Track by (turnId + query) so we only render one search item per query.
  let seenSearches = new Set();
  const resetCalls = () => {
    openCalls = new Set();
    seenMessages = new Set();
    seenSearches = new Set();
  };

  const pushRaw = (turnId, payload, at) => {
    out.push({ type: 'raw', ...(turnId ? { turnId } : {}), payload, at });
  };

  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const at = epoch(line.timestamp);
    const topType = line.type;
    const payload = line.payload;

    switch (topType) {
      case 'session_meta': {
        if (!threadStarted && payload?.id) {
          out.push({ type: 'thread_started', threadId: String(payload.id), at });
          threadStarted = true;
        }
        break;
      }

      case 'turn_context':
      case 'compacted':
        // Drop — these are diagnostic; not interesting for transcript view.
        break;

      case 'event_msg': {
        if (!payload || typeof payload !== 'object') break;
        const pType = payload.type;
        switch (pType) {
          case 'task_started': {
            currentTurnId = String(payload.turn_id || `turn-${++synth}`);
            resetCalls();
            out.push({ type: 'turn_started', turnId: currentTurnId, at });
            break;
          }
          case 'task_complete': {
            if (currentTurnId) {
              const usage = pendingTokenCount
                ? {
                    inputTokens: pendingTokenCount.input_tokens || pendingTokenCount.total_input_tokens || 0,
                    outputTokens: pendingTokenCount.output_tokens || pendingTokenCount.total_output_tokens || 0,
                  }
                : null;
              const evt = { type: 'turn_completed', turnId: currentTurnId, at };
              if (usage) evt.usage = usage;
              out.push(evt);
              pendingTokenCount = null;
              currentTurnId = null;
              resetCalls();
            }
            break;
          }
          case 'turn_aborted': {
            if (currentTurnId) {
              out.push({ type: 'turn_aborted', turnId: currentTurnId, at });
              currentTurnId = null;
              resetCalls();
            }
            break;
          }
          case 'token_count': {
            // Aggregate; attach to next turn_completed.
            const u = payload.last_token_usage || payload.info?.last_token_usage || payload;
            pendingTokenCount = {
              input_tokens: u.input_tokens ?? 0,
              output_tokens: u.output_tokens ?? 0,
            };
            break;
          }
          case 'agent_message': {
            if (!currentTurnId) break;
            const text = String(payload.message || '');
            const key = `assistant:${text.slice(0, 200)}`;
            if (seenMessages.has(key)) break;
            seenMessages.add(key);
            out.push({
              type: 'agent_message',
              turnId: currentTurnId,
              itemId: String(payload.message_id || payload.id || `am-${++synth}`),
              text,
              partial: false,
              at,
            });
            break;
          }
          case 'user_message': {
            if (!currentTurnId) break;
            const text = String(payload.message || '');
            const key = `user:${text.slice(0, 200)}`;
            if (seenMessages.has(key)) break;
            seenMessages.add(key);
            out.push({
              type: 'user_message',
              turnId: currentTurnId,
              itemId: String(payload.message_id || payload.id || `um-${++synth}`),
              text,
              at,
            });
            break;
          }
          case 'exec_command_end': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || `exec-${++synth}`);
            const command = Array.isArray(payload.command)
              ? payload.command.join(' ')
              : String(payload.command || '');
            if (!openCalls.has(callId)) {
              out.push({
                type: 'exec_command_begin',
                turnId: currentTurnId,
                callId,
                command,
                at: at - 1,
              });
              openCalls.add(callId);
            }
            out.push({
              type: 'exec_command_end',
              turnId: currentTurnId,
              callId,
              exit: Number(payload.exit_code ?? 0),
              stdout: String(payload.stdout ?? ''),
              stderr: String(payload.stderr ?? ''),
              durationMs: Number(payload.duration_ms ?? payload.duration?.secs * 1000 ?? 0),
              at,
            });
            break;
          }
          case 'mcp_tool_call_end': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || `mcp-${++synth}`);
            if (!openCalls.has(callId)) {
              out.push({
                type: 'mcp_tool_call',
                turnId: currentTurnId,
                callId,
                server: String(payload.invocation?.server || payload.server || ''),
                name: String(payload.invocation?.tool || payload.name || ''),
                args: payload.invocation?.arguments ?? payload.arguments ?? {},
                at: at - 1,
              });
              openCalls.add(callId);
            }
            const result = payload.result;
            const errored =
              payload.is_error ||
              (result && typeof result === 'object' && (result.is_error || 'error' in result));
            const evt = {
              type: 'mcp_tool_call_output',
              turnId: currentTurnId,
              callId,
              at,
            };
            if (errored) {
              evt.error = typeof result === 'string'
                ? result
                : JSON.stringify(result?.error ?? result ?? 'error');
            } else {
              evt.output = result;
            }
            out.push(evt);
            break;
          }
          case 'web_search_end': {
            if (!currentTurnId) break;
            const query = String(payload.query || '');
            const queryKey = `ws:${query}`;
            if (seenSearches.has(queryKey)) break;
            seenSearches.add(queryKey);
            const callId = String(payload.call_id || `ws-${++synth}`);
            if (!openCalls.has(callId)) {
              out.push({
                type: 'web_search_call',
                turnId: currentTurnId,
                callId,
                query,
                at: at - 1,
              });
              openCalls.add(callId);
            }
            out.push({
              type: 'web_search_end',
              turnId: currentTurnId,
              callId,
              results: Array.isArray(payload.results) ? payload.results : [],
              at,
            });
            break;
          }
          case 'patch_apply_end': {
            if (!currentTurnId) break;
            // The same callId is also used by a function_call(name='apply_patch')
            // emitted as a response_item. Suffix the patch's callId so the two
            // render as separate items rather than colliding.
            const baseCallId = String(payload.call_id || `patch-${++synth}`);
            const callId = openCalls.has(baseCallId) ? `${baseCallId}#patch` : baseCallId;
            openCalls.add(callId);
            const files = Array.isArray(payload.files)
              ? payload.files.map((f) => ({
                  path: String(f.path || ''),
                  status: f.status || 'modified',
                  ...(f.diff ? { diff: String(f.diff) } : {}),
                }))
              : [];
            out.push({
              type: 'patch_apply_end',
              turnId: currentTurnId,
              callId,
              files,
              ok: payload.success !== false,
              at,
            });
            break;
          }
          case 'agent_reasoning': {
            // Plain-text reasoning headlines (e.g. "**Planning security audit
            // steps**"). These are the readable counterpart to the encrypted
            // response_item/reasoning blobs and are the only reasoning text the
            // user can actually see.
            if (!currentTurnId) break;
            const text = String(payload.text || '');
            if (!text) break;
            const key = `reasoning:${text.slice(0, 200)}`;
            if (seenMessages.has(key)) break;
            seenMessages.add(key);
            out.push({
              type: 'reasoning',
              turnId: currentTurnId,
              itemId: String(payload.id || `ar-${++synth}`),
              text,
              partial: false,
              at,
            });
            break;
          }
          case 'view_image_tool_call': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || `vi-${++synth}`);
            if (openCalls.has(callId)) break;
            openCalls.add(callId);
            out.push({
              type: 'function_call',
              turnId: currentTurnId,
              callId,
              name: 'view_image',
              args: { path: String(payload.path || '') },
              at,
            });
            break;
          }
          case 'image_generation_end': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || `ige-${++synth}`);
            if (!openCalls.has(callId)) {
              // No paired response_item arrived first — synthesise the begin.
              out.push({
                type: 'function_call',
                turnId: currentTurnId,
                callId,
                name: 'image_generation',
                args: { prompt: String(payload.revised_prompt || payload.prompt || '') },
                at: at - 1,
              });
              openCalls.add(callId);
            }
            out.push({
              type: 'function_call_output',
              turnId: currentTurnId,
              callId,
              output: payload.saved_path
                ? { saved_path: String(payload.saved_path), status: payload.status ?? 'completed' }
                : { status: payload.status ?? 'completed' },
              at,
            });
            break;
          }
          case 'dynamic_tool_call_request': {
            if (!currentTurnId) break;
            const callId = String(payload.callId || payload.call_id || `dtc-${++synth}`);
            if (openCalls.has(callId)) break;
            openCalls.add(callId);
            out.push({
              type: 'function_call',
              turnId: currentTurnId,
              callId,
              name: String(payload.tool || 'dynamic_tool'),
              args: payload.arguments ?? {},
              at,
            });
            break;
          }
          case 'dynamic_tool_call_response': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || payload.callId || `dtr-${++synth}`);
            const evt = { type: 'function_call_output', turnId: currentTurnId, callId, at };
            if (payload.success === false) {
              evt.error = String(payload.error || 'tool failed');
            } else {
              const items = Array.isArray(payload.content_items) ? payload.content_items : [];
              evt.output = items.length === 1 && items[0]?.text
                ? items[0].text
                : items;
            }
            out.push(evt);
            break;
          }
          case 'error': {
            if (!currentTurnId) break;
            out.push({
              type: 'error_item',
              turnId: currentTurnId,
              itemId: String(payload.id || `err-${++synth}`),
              message: String(payload.message || payload.error || 'error'),
              at,
            });
            break;
          }
          // Pure metadata — drop silently rather than surfacing as raw.
          //
          // The Codex multi-agent ("collab") subsystem is fully covered by
          // response_item function calls:
          //   - `spawn_agent(...)` → `{agent_id, nickname}`         (start)
          //   - `close_agent(target)` → `{previous_status:{completed:"…"}}` (collect result)
          // The `collab_*_end` event_msg variants are mirrors of those calls
          // (with a small amount of extra metadata like the sub-thread id and
          // the human nickname). Surfacing them would create duplicate
          // tool-call cards or overwrite the authoritative response_item
          // outputs.
          case 'thread_name_updated':
          case 'context_compacted':
          case 'collab_agent_spawn_end':
          case 'collab_waiting_end':
          case 'collab_close_end':
          case 'thread_rolled_back':
            break;
          default:
            pushRaw(currentTurnId, payload, at);
            break;
        }
        break;
      }

      case 'response_item': {
        if (!currentTurnId) {
          // Some rollouts emit response_items before any task_started.
          // Synthesise an implicit turn so they don't get dropped.
          currentTurnId = `turn-pre-${++synth}`;
          resetCalls();
          out.push({ type: 'turn_started', turnId: currentTurnId, at: at - 1 });
        }
        if (!payload || typeof payload !== 'object') break;
        const pType = payload.type;
        switch (pType) {
          case 'message': {
            const text = extractContentText(payload.content);
            if (!text) break;
            const role = payload.role;
            if (role !== 'user' && role !== 'assistant') break; // developer / system / tool — drop
            const key = `${role}:${text.slice(0, 200)}`;
            if (seenMessages.has(key)) break; // already emitted via event_msg path
            seenMessages.add(key);
            const itemId = String(payload.id || `m-${++synth}`);
            if (role === 'user') {
              out.push({ type: 'user_message', turnId: currentTurnId, itemId, text, at });
            } else {
              out.push({
                type: 'agent_message', turnId: currentTurnId, itemId, text, partial: false, at,
              });
            }
            break;
          }
          case 'reasoning': {
            // `encrypted_content` is a Fernet/AES blob the model returns when no
            // reasoning summary was requested — it is opaque to clients and would
            // render as garbage like "gAAAAABqBYtO…". Skip the reasoning entirely
            // when there is no readable summary or plaintext content.
            const text =
              extractContentText(payload.summary) ||
              extractContentText(payload.content) ||
              '';
            if (!text) break;
            out.push({
              type: 'reasoning',
              turnId: currentTurnId,
              itemId: String(payload.id || `r-${++synth}`),
              text,
              partial: false,
              at,
            });
            break;
          }
          case 'function_call': {
            const callId = String(payload.call_id || payload.id || `fc-${++synth}`);
            if (openCalls.has(callId)) break; // already emitted
            openCalls.add(callId);
            out.push({
              type: 'function_call',
              turnId: currentTurnId,
              callId,
              name: String(payload.name || 'unknown'),
              args: tryParseJson(payload.arguments),
              at,
            });
            break;
          }
          case 'function_call_output': {
            const callId = String(payload.call_id || `fco-${++synth}`);
            const out_ = payload.output;
            const evt = { type: 'function_call_output', turnId: currentTurnId, callId, at };
            // Sometimes output carries an error blob; we conservatively pass it as output.
            evt.output = tryParseJson(out_);
            out.push(evt);
            break;
          }
          case 'web_search_call': {
            const query = String(payload.action?.query || payload.query || '');
            const queryKey = `ws:${query}`;
            if (seenSearches.has(queryKey)) break; // already emitted via event_msg path
            seenSearches.add(queryKey);
            const callId = String(payload.id || `ws-${++synth}`);
            if (openCalls.has(callId)) break;
            openCalls.add(callId);
            out.push({ type: 'web_search_call', turnId: currentTurnId, callId, query, at });
            // Synthesise an immediate end with empty results — the rollout doesn't
            // include the actual hits inline (those come via event_msg/web_search_end).
            out.push({ type: 'web_search_end', turnId: currentTurnId, callId, results: [], at: at + 1 });
            break;
          }
          case 'custom_tool_call': {
            const callId = String(payload.call_id || payload.id || `ct-${++synth}`);
            if (openCalls.has(callId)) break;
            openCalls.add(callId);
            out.push({
              type: 'function_call',
              turnId: currentTurnId,
              callId,
              name: String(payload.name || 'custom_tool'),
              args: tryParseJson(payload.input ?? payload.arguments),
              at,
            });
            break;
          }
          case 'custom_tool_call_output': {
            const callId = String(payload.call_id || `cto-${++synth}`);
            out.push({
              type: 'function_call_output',
              turnId: currentTurnId,
              callId,
              output: tryParseJson(payload.output),
              at,
            });
            break;
          }
          case 'tool_search_call': {
            // Codex's MCP "tool discovery": the model searches the tool catalog
            // for a query, then later calls a concrete tool. Render as a
            // function_call so the UI surfaces the search query.
            const callId = String(payload.call_id || payload.id || `ts-${++synth}`);
            if (openCalls.has(callId)) break;
            openCalls.add(callId);
            out.push({
              type: 'function_call',
              turnId: currentTurnId,
              callId,
              name: 'tool_search',
              args: payload.arguments ?? {},
              at,
            });
            break;
          }
          case 'tool_search_output': {
            const callId = String(payload.call_id || `tso-${++synth}`);
            // Summarise the discovered tool list — full descriptions can be
            // hundreds of lines and aren't useful inline.
            const tools = Array.isArray(payload.tools) ? payload.tools : [];
            const summary = tools.map((t) => ({
              name: t?.name ?? '',
              type: t?.type ?? '',
              ...(t?.description ? { description: String(t.description).slice(0, 160) } : {}),
            }));
            out.push({
              type: 'function_call_output',
              turnId: currentTurnId,
              callId,
              output: { count: tools.length, tools: summary },
              at,
            });
            break;
          }
          case 'image_generation_call': {
            const callId = String(payload.call_id || payload.id || `img-${++synth}`);
            if (openCalls.has(callId)) break;
            openCalls.add(callId);
            out.push({
              type: 'function_call',
              turnId: currentTurnId,
              callId,
              name: 'image_generation',
              args: { prompt: String(payload.revised_prompt || payload.prompt || '') },
              at,
            });
            break;
          }
          default:
            pushRaw(currentTurnId, payload, at);
            break;
        }
        break;
      }

      default:
        pushRaw(currentTurnId, line, at);
        break;
    }
  }

  // Close any dangling open turn so StatusBar shows a definite state.
  if (currentTurnId) {
    out.push({ type: 'turn_completed', turnId: currentTurnId, at: out[out.length - 1]?.at ?? Date.now() });
  }

  return out;
}

// Adapter for the AgentWeb codex-team status log (very small schema).
function adaptCodexTeam(lines) {
  const out = [];
  if (lines.length === 0) return out;
  const first = lines[0];
  const at0 = epoch(first.at);
  const turnId = 'codex-team-run';
  out.push({ type: 'thread_started', threadId: 'codex-team', at: at0 });
  out.push({ type: 'turn_started', turnId, at: at0 });

  let synth = 0;
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const at = epoch(line.at);
    const event = line.event || 'updated';
    const status = line.status || '';
    const payload = line.payload || {};
    const summary = String(payload.summary || payload.next || event);
    out.push({
      type: 'agent_message',
      turnId,
      itemId: `cte-${++synth}`,
      text: `[${event}/${status}] ${summary}`,
      partial: false,
      at,
    });
  }
  const last = lines[lines.length - 1];
  const lastStatus = String(last.status || '').toLowerCase();
  const atFinal = epoch(last.at);
  if (lastStatus === 'done') {
    out.push({ type: 'turn_completed', turnId, at: atFinal });
  } else if (lastStatus === 'failed' || lastStatus === 'needs human') {
    out.push({
      type: 'turn_failed',
      turnId,
      at: atFinal,
      error: { message: lastStatus },
    });
  } else {
    out.push({ type: 'turn_completed', turnId, at: atFinal });
  }
  return out;
}

export function parseJsonl(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return lines;
}

export function adapt(rawLines) {
  const fmt = detectFormat(rawLines);
  if (fmt === 'rollout')     return { format: 'rollout',     events: adaptRollout(rawLines) };
  if (fmt === 'codex-team')  return { format: 'codex-team',  events: adaptCodexTeam(rawLines) };
  if (fmt === 'claude-code') return { format: 'claude-code', events: adaptClaudeCode(rawLines) };
  return { format: 'unknown', events: rawLines.map((p, i) => ({ type: 'raw', payload: p, at: Date.now() + i })) };
}

const ccPrefixLines = (text, prefix) => {
  if (!text) return '';
  return text.split('\n').map((line) => `${prefix}${line}`).join('\n');
};

const ccEditDiff = (oldStr, newStr) =>
  `${ccPrefixLines(oldStr, '- ')}\n${ccPrefixLines(newStr, '+ ')}`;

const ccWriteDiff = (content) => ccPrefixLines(content, '+ ');

const ccMultiEditDiff = (edits) =>
  edits.map((e) => `${ccPrefixLines(String(e?.old_string || ''), '- ')}\n${ccPrefixLines(String(e?.new_string || ''), '+ ')}`).join('\n\n');

function adaptClaudeCode(lines) {
  const out = [];
  let threadStarted = false;
  const skipTypes = new Set(['attachment', 'system', 'last-prompt', 'queue-operation']);

  let currentTurnId = null;
  let turnUsage = null; // { lastInput, sumOutput }
  const pending = new Map(); // tool_use.id -> { kind, ... }

  const closeTurn = (at) => {
    if (!currentTurnId) return;
    const evt = { type: 'turn_completed', turnId: currentTurnId, at };
    if (turnUsage) {
      evt.usage = {
        inputTokens: turnUsage.lastInput || 0,
        outputTokens: turnUsage.sumOutput || 0,
      };
    }
    out.push(evt);
    currentTurnId = null;
    turnUsage = null;
  };

  const isTextUser = (msg) => {
    const content = msg?.content;
    if (typeof content === 'string') return true;
    if (!Array.isArray(content) || content.length === 0) return false;
    return content.every((c) => c && c.type === 'text');
  };

  const toolResultText = (item) => {
    const c = item?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c.map((p) => (typeof p === 'string' ? p : (p && typeof p === 'object' && typeof p.text === 'string') ? p.text : JSON.stringify(p))).join('\n');
    }
    if (c == null) return '';
    return JSON.stringify(c);
  };

  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    if (line.isSidechain === true) continue;

    const at = epoch(line.timestamp);

    if (!threadStarted && typeof line.sessionId === 'string' && line.sessionId.length > 0) {
      out.push({ type: 'thread_started', threadId: line.sessionId, at });
      threadStarted = true;
    }

    if (skipTypes.has(line.type)) continue;

    if (line.type === 'user' && line.message) {
      if (isTextUser(line.message)) {
        closeTurn(at);
        currentTurnId = String(line.uuid || `cc-turn-${out.length}`);
        turnUsage = { lastInput: 0, sumOutput: 0 };
        out.push({ type: 'turn_started', turnId: currentTurnId, at });

        const content = line.message.content;
        if (typeof content === 'string') {
          out.push({
            type: 'user_message', turnId: currentTurnId, itemId: currentTurnId, text: content, at,
          });
        } else {
          content.forEach((c, idx) => {
            out.push({
              type: 'user_message',
              turnId: currentTurnId,
              itemId: `${currentTurnId}:${idx}`,
              text: String(c.text || ''),
              at,
            });
          });
        }
        continue;
      }
      if (!currentTurnId) continue;
      const content = line.message.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (!item || item.type !== 'tool_result') continue;
        const callId = String(item.tool_use_id || `cc-tr-${out.length}`);
        const isError = item.is_error === true;
        const text = toolResultText(item);
        const p = pending.get(callId);

        if (p?.kind === 'exec') {
          out.push({
            type: 'exec_command_end',
            turnId: currentTurnId,
            callId,
            exit: isError ? 1 : 0,
            stdout: isError ? '' : text,
            stderr: isError ? text : '',
            durationMs: 0,
            at,
          });
          pending.delete(callId);
          continue;
        }
        if (p?.kind === 'todo') {
          pending.delete(callId);
          continue;
        }
        if (p?.kind === 'patch') {
          out.push({
            type: 'patch_apply_end',
            turnId: currentTurnId,
            callId,
            files: p.files,
            ok: !isError,
            at,
          });
          pending.delete(callId);
          continue;
        }
        // other kinds handled in later tasks
      }
      continue;
    }

    if (line.type === 'assistant' && line.message) {
      if (!currentTurnId) continue;
      const usage = line.message.usage;
      if (usage && turnUsage) {
        if (typeof usage.input_tokens === 'number') turnUsage.lastInput = usage.input_tokens;
        if (typeof usage.output_tokens === 'number') turnUsage.sumOutput = (turnUsage.sumOutput || 0) + usage.output_tokens;
      }
      const content = line.message.content;
      if (!Array.isArray(content)) continue;
      const asstUuid = String(line.uuid || `cc-a-${out.length}`);

      content.forEach((c, idx) => {
        if (!c || typeof c !== 'object') return;
        const itemId = `${asstUuid}:${idx}`;
        if (c.type === 'text') {
          out.push({
            type: 'agent_message',
            turnId: currentTurnId,
            itemId,
            text: String(c.text || ''),
            partial: false,
            at,
          });
        }
        if (c.type === 'thinking') {
          const text = typeof c.thinking === 'string' ? c.thinking : '';
          if (!text) return; // encrypted/empty — drop
          out.push({
            type: 'reasoning',
            turnId: currentTurnId,
            itemId,
            text,
            partial: false,
            at,
          });
        }
        if (c.type === 'tool_use') {
          const callId = String(c.id || `cc-tu-${out.length}`);
          const name = String(c.name || '');
          const input = c.input ?? {};

          if (name === 'Bash') {
            pending.set(callId, { kind: 'exec' });
            out.push({
              type: 'exec_command_begin',
              turnId: currentTurnId,
              callId,
              command: String(input.command || ''),
              at,
            });
            return;
          }
          if (name === 'TodoWrite') {
            pending.set(callId, { kind: 'todo' });
            const todos = Array.isArray(input.todos) ? input.todos : [];
            out.push({
              type: 'todo_list',
              turnId: currentTurnId,
              itemId: callId,
              items: todos.map((t) => ({
                text: String(t?.content || ''),
                completed: t?.status === 'completed',
              })),
              at,
            });
            return;
          }
          if (name === 'Edit') {
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path || ''),
                status: 'modified',
                diff: ccEditDiff(String(input.old_string || ''), String(input.new_string || '')),
              }],
            });
            return; // emission deferred to tool_result so we know `ok`
          }
          if (name === 'Write') {
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path || ''),
                status: 'added',
                diff: ccWriteDiff(String(input.content || '')),
              }],
            });
            return;
          }
          // other tools handled in later tasks
        }
      });
      continue;
    }
  }

  if (currentTurnId) {
    const lastAt = out.length > 0 ? out[out.length - 1].at : Date.now();
    closeTurn(lastAt);
  }

  return out;
}
