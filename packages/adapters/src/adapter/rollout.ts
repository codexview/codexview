import type { ChatStreamEvent, RawLine, SearchResult } from '../types.js';

const epoch = (iso: unknown): number => {
  if (typeof iso === 'number') return iso;
  if (typeof iso !== 'string') return Date.now();
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
};

const tryParseJson = (s: unknown): unknown => {
  if (s == null || typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
};

const extractContentText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') return (c as { text?: string }).text ?? '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

interface TokenUsageBucket {
  input_tokens: number;
  output_tokens: number;
}

export interface AdaptRolloutOptions {
  /**
   * Older, fully-written rollout files sometimes miss terminal lifecycle
   * events, so the historical default is to close an open turn at EOF. Live
   * tailers should set this to false so an in-progress Codex run stays running.
   */
  closeOpenTurn?: boolean;
}

export function adaptRollout(lines: RawLine[], options: AdaptRolloutOptions = {}): ChatStreamEvent[] {
  const closeOpenTurn = options.closeOpenTurn ?? true;
  const out: ChatStreamEvent[] = [];
  let currentTurnId: string | null = null;
  let threadStarted = false;
  let pendingTokenCount: TokenUsageBucket | null = null;
  let synth = 0;
  let openCalls = new Set<string>();
  let seenMessages = new Set<string>();
  let seenSearches = new Set<string>();
  const resetCalls = () => {
    openCalls = new Set<string>();
    seenMessages = new Set<string>();
    seenSearches = new Set<string>();
  };

  const pushRaw = (turnId: string | null, payload: unknown, at: number) => {
    out.push({ type: 'raw', ...(turnId ? { turnId } : {}), payload, at });
  };

  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const at = epoch((line as RawLine).timestamp);
    const topType = (line as RawLine).type;
    const payload = (line as RawLine).payload as Record<string, unknown> | undefined;

    switch (topType) {
      case 'session_meta': {
        if (!threadStarted && payload?.id != null) {
          out.push({ type: 'thread_started', threadId: String(payload.id), at });
          threadStarted = true;
        }
        break;
      }

      case 'turn_context':
      case 'compacted':
        break;

      case 'event_msg': {
        if (!payload || typeof payload !== 'object') break;
        const pType = payload.type as string;
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
                    inputTokens: pendingTokenCount.input_tokens || 0,
                    outputTokens: pendingTokenCount.output_tokens || 0,
                  }
                : undefined;
              const evt: ChatStreamEvent = usage
                ? { type: 'turn_completed', turnId: currentTurnId, at, usage }
                : { type: 'turn_completed', turnId: currentTurnId, at };
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
            const info = payload.info as Record<string, unknown> | undefined;
            const u = (payload.last_token_usage as Record<string, unknown> | undefined)
              || (info?.last_token_usage as Record<string, unknown> | undefined)
              || (payload as Record<string, unknown>);
            pendingTokenCount = {
              input_tokens: Number(u?.input_tokens ?? 0),
              output_tokens: Number(u?.output_tokens ?? 0),
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
              ? (payload.command as unknown[]).join(' ')
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
            const dur = payload.duration_ms ?? (payload.duration as Record<string, unknown> | undefined)?.secs;
            out.push({
              type: 'exec_command_end',
              turnId: currentTurnId,
              callId,
              exit: Number(payload.exit_code ?? 0),
              stdout: String(payload.stdout ?? ''),
              stderr: String(payload.stderr ?? ''),
              durationMs: Number(typeof dur === 'number' ? dur : 0),
              at,
            });
            break;
          }
          case 'mcp_tool_call_end': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || `mcp-${++synth}`);
            const invocation = payload.invocation as Record<string, unknown> | undefined;
            if (!openCalls.has(callId)) {
              out.push({
                type: 'mcp_tool_call',
                turnId: currentTurnId,
                callId,
                server: String(invocation?.server || payload.server || ''),
                name: String(invocation?.tool || payload.name || ''),
                args: invocation?.arguments ?? payload.arguments ?? {},
                at: at - 1,
              });
              openCalls.add(callId);
            }
            const result = payload.result;
            const resultObj = (result && typeof result === 'object') ? result as Record<string, unknown> : null;
            const errored =
              payload.is_error ||
              (resultObj && (resultObj.is_error || 'error' in resultObj));
            if (errored) {
              out.push({
                type: 'mcp_tool_call_output',
                turnId: currentTurnId,
                callId,
                error: typeof result === 'string'
                  ? result
                  : JSON.stringify(resultObj?.error ?? result ?? 'error'),
                at,
              });
            } else {
              out.push({
                type: 'mcp_tool_call_output',
                turnId: currentTurnId,
                callId,
                output: result,
                at,
              });
            }
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
              results: Array.isArray(payload.results) ? (payload.results as SearchResult[]) : [],
              at,
            });
            break;
          }
          case 'patch_apply_end': {
            if (!currentTurnId) break;
            const baseCallId = String(payload.call_id || `patch-${++synth}`);
            const callId = openCalls.has(baseCallId) ? `${baseCallId}#patch` : baseCallId;
            openCalls.add(callId);
            const filesRaw = Array.isArray(payload.files) ? payload.files as Record<string, unknown>[] : [];
            const files = filesRaw.map((f) => {
              const base: { path: string; status: 'added' | 'modified' | 'deleted'; diff?: string } = {
                path: String(f.path || ''),
                status: (f.status as 'added' | 'modified' | 'deleted') || 'modified',
              };
              if (f.diff) base.diff = String(f.diff);
              return base;
            });
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
            if (payload.success === false) {
              out.push({
                type: 'function_call_output',
                turnId: currentTurnId,
                callId,
                error: String(payload.error || 'tool failed'),
                at,
              });
            } else {
              const items = Array.isArray(payload.content_items) ? payload.content_items as Record<string, unknown>[] : [];
              const output = items.length === 1 && typeof items[0]?.text === 'string'
                ? items[0].text
                : items;
              out.push({
                type: 'function_call_output',
                turnId: currentTurnId,
                callId,
                output,
                at,
              });
            }
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
          currentTurnId = `turn-pre-${++synth}`;
          resetCalls();
          out.push({ type: 'turn_started', turnId: currentTurnId, at: at - 1 });
        }
        if (!payload || typeof payload !== 'object') break;
        const pType = payload.type as string;
        switch (pType) {
          case 'message': {
            const text = extractContentText(payload.content);
            if (!text) break;
            const role = payload.role;
            if (role !== 'user' && role !== 'assistant') break;
            const key = `${role}:${text.slice(0, 200)}`;
            if (seenMessages.has(key)) break;
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
            if (openCalls.has(callId)) break;
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
            out.push({
              type: 'function_call_output',
              turnId: currentTurnId,
              callId,
              output: tryParseJson(payload.output),
              at,
            });
            break;
          }
          case 'web_search_call': {
            const action = payload.action as Record<string, unknown> | undefined;
            const query = String(action?.query || payload.query || '');
            const queryKey = `ws:${query}`;
            if (seenSearches.has(queryKey)) break;
            seenSearches.add(queryKey);
            const callId = String(payload.id || `ws-${++synth}`);
            if (openCalls.has(callId)) break;
            openCalls.add(callId);
            out.push({ type: 'web_search_call', turnId: currentTurnId, callId, query, at });
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
            const tools = Array.isArray(payload.tools) ? payload.tools as Record<string, unknown>[] : [];
            const summary = tools.map((t) => {
              const entry: Record<string, unknown> = {
                name: t?.name ?? '',
                type: t?.type ?? '',
              };
              if (t?.description) entry.description = String(t.description).slice(0, 160);
              return entry;
            });
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

  if (currentTurnId && closeOpenTurn) {
    out.push({ type: 'turn_completed', turnId: currentTurnId, at: out[out.length - 1]?.at ?? Date.now() });
  }

  return out;
}
