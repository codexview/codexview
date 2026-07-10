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
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}

const messagePhase = (value: unknown): 'commentary' | 'final_answer' | undefined =>
  value === 'commentary' || value === 'final_answer' ? value : undefined;

const durationMs = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return 0;
  const duration = value as Record<string, unknown>;
  return (Number(duration.secs ?? 0) * 1000) + (Number(duration.nanos ?? 0) / 1_000_000);
};

const dynamicToolOutput = (value: unknown): unknown => {
  const items = Array.isArray(value) ? value as Record<string, unknown>[] : [];
  return items.length === 1 && typeof items[0]?.text === 'string' ? items[0].text : items;
};

type MessageSource = 'canonical' | 'event_msg' | 'response_item';

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
  let completedCalls = new Set<string>();
  let seenMessageIds = new Set<string>();
  let seenMessageFallbacks = new Map<string, Set<MessageSource>>();
  let seenSearches = new Set<string>();
  let completedItems = new Set<string>();
  const startedTurnIds = new Set<string>();
  const resetCalls = () => {
    openCalls = new Set<string>();
    completedCalls = new Set<string>();
    seenMessageIds = new Set<string>();
    seenMessageFallbacks = new Map<string, Set<MessageSource>>();
    seenSearches = new Set<string>();
    completedItems = new Set<string>();
  };

  const hasSeenMessage = (
    role: 'user' | 'assistant' | 'reasoning',
    text: string,
    phase: 'commentary' | 'final_answer' | undefined,
    source: MessageSource,
    itemId?: string,
  ): boolean => {
    const fallback = `${role}:${phase ?? ''}:${text}`;
    const sources = seenMessageFallbacks.get(fallback);
    if (itemId) {
      if (seenMessageIds.has(itemId)) return true;
      seenMessageIds.add(itemId);
    }
    const mirrored = Boolean(sources && !sources.has(source));
    if (sources) sources.add(source);
    else seenMessageFallbacks.set(fallback, new Set([source]));
    return mirrored;
  };

  const pushRaw = (turnId: string | null, payload: unknown, at: number) => {
    out.push({ type: 'raw', ...(turnId ? { turnId } : {}), payload, at });
  };

  const ensureTurn = (turnId: unknown, at: number): string => {
    const explicitTurnId = turnId == null ? '' : String(turnId);
    if (!currentTurnId || (explicitTurnId && explicitTurnId !== currentTurnId)) {
      currentTurnId = explicitTurnId || `turn-${++synth}`;
      pendingTokenCount = null;
      resetCalls();
      if (!startedTurnIds.has(currentTurnId)) {
        startedTurnIds.add(currentTurnId);
        out.push({ type: 'turn_started', turnId: currentTurnId, at: at - 1 });
      }
    }
    return currentTurnId;
  };

  const emitCanonicalItem = (
    event: Record<string, unknown>,
    lifecycle: 'started' | 'completed',
    at: number,
  ) => {
    const item = event.item as Record<string, unknown> | undefined;
    if (!item || typeof item !== 'object') return;
    const canonicalAt = Number(
      lifecycle === 'started' ? event.started_at_ms : event.completed_at_ms,
    );
    if (Number.isFinite(canonicalAt) && canonicalAt > 0) at = canonicalAt;
    const turnId = ensureTurn(event.turn_id, at);
    const itemType = String(item.type || '');
    const itemId = String(item.id || `${itemType || 'item'}-${++synth}`);
    const completedKey = `${itemType}:${itemId}`;
    if (lifecycle === 'completed') {
      if (completedItems.has(completedKey)) return;
      completedItems.add(completedKey);
    }

    switch (itemType) {
      case 'UserMessage': {
        if (lifecycle !== 'completed') break;
        const text = extractContentText(item.content);
        if (!text) break;
        if (hasSeenMessage('user', text, undefined, 'canonical', itemId)) break;
        out.push({ type: 'user_message', turnId, itemId, text, at });
        break;
      }
      case 'AgentMessage': {
        if (lifecycle !== 'completed') break;
        const text = extractContentText(item.content);
        if (!text) break;
        const phase = messagePhase(item.phase);
        if (hasSeenMessage('assistant', text, phase, 'canonical', itemId)) break;
        out.push({
          type: 'agent_message', turnId, itemId, text, partial: false, ...(phase ? { phase } : {}), at,
        });
        break;
      }
      case 'Reasoning': {
        if (lifecycle !== 'completed') break;
        const text = extractContentText(item.summary_text) || extractContentText(item.raw_content);
        if (!text) break;
        if (hasSeenMessage('reasoning', text, undefined, 'canonical', itemId)) break;
        out.push({ type: 'reasoning', turnId, itemId, text, partial: false, at });
        break;
      }
      case 'CommandExecution': {
        const callId = itemId;
        const command = Array.isArray(item.command)
          ? (item.command as unknown[]).join(' ')
          : String(item.command || '');
        if (lifecycle === 'started') {
          if (openCalls.has(callId) || completedCalls.has(callId)) break;
          openCalls.add(callId);
          out.push({ type: 'exec_command_begin', turnId, callId, command, at });
          break;
        }
        if (completedCalls.has(callId)) break;
        if (!openCalls.has(callId)) {
          openCalls.add(callId);
          out.push({ type: 'exec_command_begin', turnId, callId, command, at: at - 1 });
        }
        completedCalls.add(callId);
        out.push({
          type: 'exec_command_end',
          turnId,
          callId,
          exit: Number(item.exit_code ?? (item.status === 'completed' ? 0 : 1)),
          stdout: String(item.stdout ?? item.aggregated_output ?? item.formatted_output ?? ''),
          stderr: String(item.stderr ?? ''),
          durationMs: durationMs(item.duration),
          at,
        });
        break;
      }
      case 'DynamicToolCall': {
        const callId = itemId;
        if (lifecycle === 'started') {
          if (openCalls.has(callId) || completedCalls.has(callId)) break;
          openCalls.add(callId);
          out.push({
            type: 'function_call',
            turnId,
            callId,
            name: String(item.tool || 'dynamic_tool'),
            args: item.arguments ?? {},
            at,
          });
          break;
        }
        if (completedCalls.has(callId)) break;
        if (!openCalls.has(callId)) {
          openCalls.add(callId);
          out.push({
            type: 'function_call',
            turnId,
            callId,
            name: String(item.tool || 'dynamic_tool'),
            args: item.arguments ?? {},
            at: at - 1,
          });
        }
        completedCalls.add(callId);
        if (item.success === false || item.status === 'failed' || item.error) {
          out.push({
            type: 'function_call_output',
            turnId,
            callId,
            error: String(item.error || 'tool failed'),
            at,
          });
        } else {
          out.push({
            type: 'function_call_output',
            turnId,
            callId,
            output: dynamicToolOutput(item.content_items),
            at,
          });
        }
        break;
      }
      case 'FileChange': {
        if (lifecycle !== 'completed') break;
        const baseCallId = itemId;
        const callId = openCalls.has(baseCallId) ? `${baseCallId}#patch` : baseCallId;
        if (completedCalls.has(callId)) break;
        const changes = item.changes && typeof item.changes === 'object'
          ? item.changes as Record<string, unknown>
          : {};
        const files = Object.entries(changes).map(([path, rawChange]) => {
          const change = rawChange && typeof rawChange === 'object'
            ? rawChange as Record<string, unknown>
            : {};
          const changeType = String(change.type || '').toLowerCase();
          const status = changeType === 'add'
            ? 'added' as const
            : changeType === 'delete'
              ? 'deleted' as const
              : 'modified' as const;
          const diff = change.unified_diff;
          return {
            path,
            status,
            ...(typeof diff === 'string' && diff ? { diff } : {}),
          };
        });
        completedCalls.add(callId);
        out.push({
          type: 'patch_apply_end',
          turnId,
          callId,
          files,
          ok: item.status !== 'failed' && item.status !== 'declined',
          at,
        });
        break;
      }
      case 'McpToolCall': {
        const callId = itemId;
        if (lifecycle === 'started') {
          if (openCalls.has(callId) || completedCalls.has(callId)) break;
          openCalls.add(callId);
          out.push({
            type: 'mcp_tool_call',
            turnId,
            callId,
            server: String(item.server || ''),
            name: String(item.tool || ''),
            args: item.arguments ?? {},
            at,
          });
          break;
        }
        if (completedCalls.has(callId)) break;
        if (!openCalls.has(callId)) {
          openCalls.add(callId);
          out.push({
            type: 'mcp_tool_call',
            turnId,
            callId,
            server: String(item.server || ''),
            name: String(item.tool || ''),
            args: item.arguments ?? {},
            at: at - 1,
          });
        }
        completedCalls.add(callId);
        const error = item.error && typeof item.error === 'object'
          ? String((item.error as Record<string, unknown>).message || 'tool failed')
          : undefined;
        if (error || item.status === 'failed') {
          out.push({
            type: 'mcp_tool_call_output', turnId, callId, error: error || 'tool failed', at,
          });
        } else {
          out.push({ type: 'mcp_tool_call_output', turnId, callId, output: item.result, at });
        }
        break;
      }
      case 'WebSearch': {
        const callId = itemId;
        const query = String(item.query || '');
        if (lifecycle === 'started') {
          if (openCalls.has(callId) || completedCalls.has(callId)) break;
          openCalls.add(callId);
          out.push({ type: 'web_search_call', turnId, callId, query, at });
          break;
        }
        if (completedCalls.has(callId)) break;
        if (!openCalls.has(callId)) {
          openCalls.add(callId);
          out.push({ type: 'web_search_call', turnId, callId, query, at: at - 1 });
        }
        completedCalls.add(callId);
        out.push({ type: 'web_search_end', turnId, callId, results: [], at });
        break;
      }
      case 'Todo':
      case 'TodoList': {
        if (lifecycle !== 'completed') break;
        const rawItems = Array.isArray(item.items)
          ? item.items as Record<string, unknown>[]
          : Array.isArray(item.plan) ? item.plan as Record<string, unknown>[] : [];
        out.push({
          type: 'todo_list',
          turnId,
          itemId,
          items: rawItems.map((entry) => ({
            text: String(entry.text ?? entry.step ?? ''),
            completed: entry.completed === true || entry.status === 'completed',
          })),
          at,
        });
        break;
      }
      case 'Plan':
      case 'SubAgentActivity': {
        if (lifecycle !== 'completed') break;
        out.push({ type: 'raw', turnId, itemId, payload: item, at });
        break;
      }
      case 'CollabAgentToolCall': {
        const callId = itemId;
        const name = `collab_agent_${String(item.tool || 'call')}`;
        const args = {
          sender_thread_id: item.sender_thread_id,
          receiver_thread_ids: item.receiver_thread_ids,
          receiver_agents: item.receiver_agents,
          ...(item.prompt != null ? { prompt: item.prompt } : {}),
          ...(item.model != null ? { model: item.model } : {}),
        };
        if (lifecycle === 'started') {
          if (openCalls.has(callId) || completedCalls.has(callId)) break;
          openCalls.add(callId);
          out.push({ type: 'function_call', turnId, callId, name, args, at });
          break;
        }
        if (completedCalls.has(callId)) break;
        if (!openCalls.has(callId)) {
          openCalls.add(callId);
          out.push({ type: 'function_call', turnId, callId, name, args, at: at - 1 });
        }
        completedCalls.add(callId);
        if (item.status === 'failed') {
          out.push({ type: 'function_call_output', turnId, callId, error: 'collaboration call failed', at });
        } else {
          out.push({
            type: 'function_call_output',
            turnId,
            callId,
            output: { status: item.status, agents_states: item.agents_states },
            at,
          });
        }
        break;
      }
      case 'ContextCompaction':
        break;
      default:
        if (lifecycle === 'completed') {
          out.push({ type: 'raw', turnId, itemId, payload: item, at });
        }
        break;
    }
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
      case 'world_state':
      case 'inter_agent_communication_metadata':
        break;

      case 'event_msg': {
        if (!payload || typeof payload !== 'object') break;
        const pType = payload.type as string;
        switch (pType) {
          case 'task_started': {
            const turnId = String(payload.turn_id || `turn-${++synth}`);
            if (currentTurnId !== turnId) {
              currentTurnId = turnId;
              pendingTokenCount = null;
              resetCalls();
            }
            if (!startedTurnIds.has(turnId)) {
              startedTurnIds.add(turnId);
              out.push({ type: 'turn_started', turnId, at });
            }
            break;
          }
          case 'task_complete': {
            if (currentTurnId) {
              const usage = pendingTokenCount
                ? {
                    inputTokens: pendingTokenCount.input_tokens || 0,
                    cachedInputTokens: pendingTokenCount.cached_input_tokens || 0,
                    outputTokens: pendingTokenCount.output_tokens || 0,
                    reasoningOutputTokens: pendingTokenCount.reasoning_output_tokens || 0,
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
              pendingTokenCount = null;
              currentTurnId = null;
              resetCalls();
            }
            break;
          }
          case 'token_count': {
            const info = payload.info as Record<string, unknown> | undefined;
            const u = (payload.last_token_usage as Record<string, unknown> | undefined)
              || (info?.last_token_usage as Record<string, unknown> | undefined);
            if (!u) break;
            pendingTokenCount = {
              input_tokens: Number(u.input_tokens ?? 0),
              cached_input_tokens: Number(u.cached_input_tokens ?? 0),
              output_tokens: Number(u.output_tokens ?? 0),
              reasoning_output_tokens: Number(u.reasoning_output_tokens ?? 0),
            };
            break;
          }
          case 'item_started':
            emitCanonicalItem(payload, 'started', at);
            break;
          case 'item_completed':
            emitCanonicalItem(payload, 'completed', at);
            break;
          case 'item_updated': {
            const item = payload.item as Record<string, unknown> | undefined;
            const status = item?.status;
            emitCanonicalItem(
              payload,
              status === 'completed' || status === 'failed' || status === 'declined'
                ? 'completed'
                : 'started',
              at,
            );
            break;
          }
          case 'agent_message': {
            if (!currentTurnId) break;
            const text = String(payload.message || '');
            const phase = messagePhase(payload.phase);
            const sourceItemId = payload.message_id ?? payload.id;
            if (hasSeenMessage(
              'assistant', text, phase, 'event_msg', sourceItemId == null ? undefined : String(sourceItemId),
            )) break;
            out.push({
              type: 'agent_message',
              turnId: currentTurnId,
              itemId: String(payload.message_id || payload.id || `am-${++synth}`),
              text,
              partial: false,
              ...(phase ? { phase } : {}),
              at,
            });
            break;
          }
          case 'user_message': {
            if (!currentTurnId) break;
            const text = String(payload.message || '');
            const sourceItemId = payload.message_id ?? payload.id;
            if (hasSeenMessage(
              'user', text, undefined, 'event_msg', sourceItemId == null ? undefined : String(sourceItemId),
            )) break;
            out.push({
              type: 'user_message',
              turnId: currentTurnId,
              itemId: String(payload.message_id || payload.id || `um-${++synth}`),
              text,
              at,
            });
            break;
          }
          case 'exec_command_begin': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || `exec-${++synth}`);
            if (openCalls.has(callId) || completedCalls.has(callId)) break;
            const command = Array.isArray(payload.command)
              ? (payload.command as unknown[]).join(' ')
              : String(payload.command || '');
            openCalls.add(callId);
            out.push({ type: 'exec_command_begin', turnId: currentTurnId, callId, command, at });
            break;
          }
          case 'exec_command_end': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || `exec-${++synth}`);
            if (completedCalls.has(callId)) break;
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
            const dur = payload.duration_ms == null
              ? durationMs(payload.duration)
              : Number(payload.duration_ms);
            completedCalls.add(callId);
            out.push({
              type: 'exec_command_end',
              turnId: currentTurnId,
              callId,
              exit: Number(payload.exit_code ?? 0),
              stdout: String(payload.stdout ?? ''),
              stderr: String(payload.stderr ?? ''),
              durationMs: Number.isFinite(dur) ? dur : 0,
              at,
            });
            break;
          }
          case 'mcp_tool_call_begin': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || `mcp-${++synth}`);
            if (openCalls.has(callId) || completedCalls.has(callId)) break;
            const invocation = payload.invocation as Record<string, unknown> | undefined;
            openCalls.add(callId);
            out.push({
              type: 'mcp_tool_call',
              turnId: currentTurnId,
              callId,
              server: String(invocation?.server || payload.server || ''),
              name: String(invocation?.tool || payload.name || ''),
              args: invocation?.arguments ?? payload.arguments ?? {},
              at,
            });
            break;
          }
          case 'mcp_tool_call_end': {
            if (!currentTurnId) break;
            const callId = String(payload.call_id || `mcp-${++synth}`);
            if (completedCalls.has(callId)) break;
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
            completedCalls.add(callId);
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
          case 'web_search_begin': {
            if (!currentTurnId) break;
            const query = String(payload.query || '');
            const queryKey = `ws:${query}`;
            const sourceCallId = payload.call_id;
            const callId = String(sourceCallId || `ws-${++synth}`);
            if (
              openCalls.has(callId)
              || completedCalls.has(callId)
              || (sourceCallId == null && seenSearches.has(queryKey))
            ) break;
            if (sourceCallId == null) seenSearches.add(queryKey);
            openCalls.add(callId);
            out.push({ type: 'web_search_call', turnId: currentTurnId, callId, query, at });
            break;
          }
          case 'web_search_end': {
            if (!currentTurnId) break;
            const query = String(payload.query || '');
            const queryKey = `ws:${query}`;
            const sourceCallId = payload.call_id;
            const callId = String(sourceCallId || `ws-${++synth}`);
            if (completedCalls.has(callId)) break;
            if (sourceCallId == null && seenSearches.has(queryKey) && !openCalls.has(callId)) break;
            if (sourceCallId == null) seenSearches.add(queryKey);
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
            completedCalls.add(callId);
            out.push({
              type: 'web_search_end',
              turnId: currentTurnId,
              callId,
              results: Array.isArray(payload.results) ? (payload.results as SearchResult[]) : [],
              at,
            });
            break;
          }
          case 'patch_apply_begin':
          case 'patch_apply_updated':
            break;
          case 'patch_apply_end': {
            if (!currentTurnId) break;
            const baseCallId = String(payload.call_id || `patch-${++synth}`);
            const callId = openCalls.has(baseCallId) ? `${baseCallId}#patch` : baseCallId;
            if (completedCalls.has(callId)) break;
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
            completedCalls.add(callId);
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
            const sourceItemId = payload.id;
            if (hasSeenMessage(
              'reasoning', text, undefined, 'event_msg', sourceItemId == null ? undefined : String(sourceItemId),
            )) break;
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
            if (openCalls.has(callId) || completedCalls.has(callId)) break;
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
            if (completedCalls.has(callId)) break;
            if (!openCalls.has(callId)) {
              openCalls.add(callId);
              out.push({
                type: 'function_call',
                turnId: currentTurnId,
                callId,
                name: String(payload.tool || 'dynamic_tool'),
                args: payload.arguments ?? {},
                at: at - 1,
              });
            }
            completedCalls.add(callId);
            if (payload.success === false) {
              out.push({
                type: 'function_call_output',
                turnId: currentTurnId,
                callId,
                error: String(payload.error || 'tool failed'),
                at,
              });
            } else {
              out.push({
                type: 'function_call_output',
                turnId: currentTurnId,
                callId,
                output: dynamicToolOutput(payload.content_items),
                at,
              });
            }
            break;
          }
          case 'plan_update': {
            if (!currentTurnId) break;
            const plan = Array.isArray(payload.plan) ? payload.plan as Record<string, unknown>[] : [];
            out.push({
              type: 'todo_list',
              turnId: currentTurnId,
              itemId: String(payload.id || `plan-${++synth}`),
              items: plan.map((entry) => ({
                text: String(entry.step || ''),
                completed: entry.status === 'completed',
              })),
              at,
            });
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
          case 'thread_settings_applied':
          case 'thread_goal_updated':
          case 'session_configured':
          case 'collab_agent_spawn_begin':
          case 'collab_agent_spawn_end':
          case 'collab_agent_interaction_begin':
          case 'collab_agent_interaction_end':
          case 'collab_waiting_begin':
          case 'collab_waiting_end':
          case 'collab_close_begin':
          case 'collab_close_end':
          case 'collab_resume_begin':
          case 'collab_resume_end':
          case 'sub_agent_activity':
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
          startedTurnIds.add(currentTurnId);
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
            const phase = role === 'assistant' ? messagePhase(payload.phase) : undefined;
            const sourceItemId = payload.id;
            if (hasSeenMessage(
              role, text, phase, 'response_item', sourceItemId == null ? undefined : String(sourceItemId),
            )) break;
            const itemId = String(sourceItemId || `m-${++synth}`);
            if (role === 'user') {
              out.push({ type: 'user_message', turnId: currentTurnId, itemId, text, at });
            } else {
              out.push({
                type: 'agent_message',
                turnId: currentTurnId,
                itemId,
                text,
                partial: false,
                ...(phase ? { phase } : {}),
                at,
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
            const sourceItemId = payload.id;
            if (hasSeenMessage(
              'reasoning', text, undefined, 'response_item', sourceItemId == null ? undefined : String(sourceItemId),
            )) break;
            out.push({
              type: 'reasoning',
              turnId: currentTurnId,
              itemId: String(sourceItemId || `r-${++synth}`),
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
            if (completedCalls.has(callId)) break;
            completedCalls.add(callId);
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
            const sourceCallId = payload.id;
            if (sourceCallId == null && seenSearches.has(queryKey)) break;
            if (sourceCallId == null) seenSearches.add(queryKey);
            const callId = String(sourceCallId || `ws-${++synth}`);
            if (openCalls.has(callId) || completedCalls.has(callId)) break;
            openCalls.add(callId);
            completedCalls.add(callId);
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
            if (completedCalls.has(callId)) break;
            completedCalls.add(callId);
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
            if (completedCalls.has(callId)) break;
            completedCalls.add(callId);
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
