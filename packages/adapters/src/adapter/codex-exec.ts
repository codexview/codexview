import type { ChatStreamEvent, PatchFile, RawLine, TodoEntry } from '../types.js';

export interface AdaptCodexExecOptions {
  /** Base timestamp for the timestamp-free `codex exec --json` stream. */
  startAt?: number;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? value as Record<string, unknown> : null;

const asNumber = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function adaptCodexExec(
  lines: RawLine[],
  options: AdaptCodexExecOptions = {},
): ChatStreamEvent[] {
  const startAt = options.startAt ?? 0;
  const out: ChatStreamEvent[] = [];
  let threadId: string | null = null;
  let currentTurnId: string | null = null;
  let terminalErrorTurnId: string | null = null;
  let turnSequence = 0;
  let syntheticItemSequence = 0;
  let begunCalls = new Set<string>();
  let completedItems = new Set<string>();

  const resetItems = () => {
    begunCalls = new Set<string>();
    completedItems = new Set<string>();
  };

  const startTurn = (at: number): string => {
    const ordinal = ++turnSequence;
    currentTurnId = threadId ? `${threadId}:turn:${ordinal}` : `turn-${ordinal}`;
    terminalErrorTurnId = null;
    resetItems();
    out.push({ type: 'turn_started', turnId: currentTurnId, at });
    return currentTurnId;
  };

  const ensureTurn = (at: number): string => currentTurnId ?? startTurn(at);

  const emitCallBegin = (
    item: Record<string, unknown>,
    itemId: string,
    turnId: string,
    at: number,
  ) => {
    if (begunCalls.has(itemId)) return;

    switch (item.type) {
      case 'command_execution':
        out.push({
          type: 'exec_command_begin',
          turnId,
          callId: itemId,
          command: String(item.command ?? ''),
          at,
        });
        break;
      case 'mcp_tool_call':
        out.push({
          type: 'mcp_tool_call',
          turnId,
          callId: itemId,
          server: String(item.server ?? ''),
          name: String(item.tool ?? ''),
          args: item.arguments ?? {},
          at,
        });
        break;
      case 'collab_tool_call':
        out.push({
          type: 'function_call',
          turnId,
          callId: itemId,
          name: `collab.${String(item.tool ?? '')}`,
          args: {
            senderThreadId: item.sender_thread_id,
            receiverThreadIds: item.receiver_thread_ids,
            prompt: item.prompt,
          },
          at,
        });
        break;
      case 'web_search':
        out.push({
          type: 'web_search_call',
          turnId,
          callId: itemId,
          query: String(item.query ?? ''),
          at,
        });
        break;
      default:
        return;
    }

    begunCalls.add(itemId);
  };

  const emitCallEnd = (
    item: Record<string, unknown>,
    itemId: string,
    turnId: string,
    at: number,
  ) => {
    switch (item.type) {
      case 'command_execution': {
        const status = String(item.status ?? 'completed');
        out.push({
          type: 'exec_command_end',
          turnId,
          callId: itemId,
          exit: asNumber(item.exit_code, status === 'completed' ? 0 : 1),
          stdout: String(item.aggregated_output ?? ''),
          stderr: '',
          durationMs: 0,
          at,
        });
        break;
      }
      case 'mcp_tool_call': {
        const error = asRecord(item.error);
        const failed = item.status === 'failed';
        const event: ChatStreamEvent = error || failed
          ? {
              type: 'mcp_tool_call_output',
              turnId,
              callId: itemId,
              error: String(error?.message ?? 'MCP tool call failed'),
              at,
            }
          : {
              type: 'mcp_tool_call_output',
              turnId,
              callId: itemId,
              output: item.result,
              at,
            };
        out.push(event);
        break;
      }
      case 'collab_tool_call': {
        const failed = item.status === 'failed';
        const event: ChatStreamEvent = failed
          ? {
              type: 'function_call_output',
              turnId,
              callId: itemId,
              error: `Collab tool ${String(item.tool ?? '')} failed`,
              at,
            }
          : {
              type: 'function_call_output',
              turnId,
              callId: itemId,
              output: {
                status: item.status,
                receiverThreadIds: item.receiver_thread_ids,
                agentsStates: item.agents_states,
              },
              at,
            };
        out.push(event);
        break;
      }
      case 'web_search':
        out.push({ type: 'web_search_end', turnId, callId: itemId, results: [], at });
        break;
    }
  };

  lines.forEach((line, index) => {
    if (!line || typeof line !== 'object') return;
    const at = startAt + index;

    switch (line.type) {
      case 'thread.started':
        threadId = String(line.thread_id ?? '');
        out.push({ type: 'thread_started', threadId, at });
        break;

      case 'turn.started':
        startTurn(at);
        break;

      case 'turn.completed': {
        const turnId = ensureTurn(at);
        const usage = asRecord(line.usage);
        out.push({
          type: 'turn_completed',
          turnId,
          at,
          usage: {
            inputTokens: asNumber(usage?.input_tokens),
            cachedInputTokens: asNumber(usage?.cached_input_tokens),
            outputTokens: asNumber(usage?.output_tokens),
            reasoningOutputTokens: asNumber(usage?.reasoning_output_tokens),
          },
        });
        currentTurnId = null;
        resetItems();
        break;
      }

      case 'turn.failed': {
        if (!currentTurnId && terminalErrorTurnId) {
          terminalErrorTurnId = null;
          break;
        }
        const turnId = ensureTurn(at);
        const error = asRecord(line.error);
        out.push({
          type: 'turn_failed',
          turnId,
          at,
          error: { message: String(error?.message ?? 'turn failed') },
        });
        terminalErrorTurnId = turnId;
        currentTurnId = null;
        resetItems();
        break;
      }

      case 'error': {
        const turnId = ensureTurn(at);
        out.push({
          type: 'turn_failed',
          turnId,
          at,
          error: { message: String(line.message ?? 'stream failed') },
        });
        terminalErrorTurnId = turnId;
        currentTurnId = null;
        resetItems();
        break;
      }

      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const item = asRecord(line.item);
        if (!item) {
          out.push({ type: 'raw', payload: line, at });
          break;
        }

        const turnId = ensureTurn(at);
        const itemId = String(item.id ?? `item-${++syntheticItemSequence}`);
        const lifecycle = line.type.slice('item.'.length);
        if (lifecycle === 'completed' && completedItems.has(itemId)) break;

        if (lifecycle === 'started') emitCallBegin(item, itemId, turnId, at);
        if (lifecycle === 'completed') emitCallBegin(item, itemId, turnId, at);

        switch (item.type) {
          case 'agent_message':
            out.push({
              type: 'agent_message',
              turnId,
              itemId,
              text: String(item.text ?? ''),
              partial: lifecycle !== 'completed',
              at,
            });
            break;
          case 'reasoning':
            out.push({
              type: 'reasoning',
              turnId,
              itemId,
              text: String(item.text ?? ''),
              partial: lifecycle !== 'completed',
              at,
            });
            break;
          case 'command_execution':
          case 'mcp_tool_call':
          case 'collab_tool_call':
          case 'web_search':
            if (lifecycle === 'completed') emitCallEnd(item, itemId, turnId, at);
            break;
          case 'file_change':
            if (lifecycle === 'completed') {
              const changes = Array.isArray(item.changes) ? item.changes : [];
              const files: PatchFile[] = changes.map((change) => {
                const value = asRecord(change);
                const kind = String(value?.kind ?? 'update');
                return {
                  path: String(value?.path ?? ''),
                  status: kind === 'add' ? 'added' : kind === 'delete' ? 'deleted' : 'modified',
                };
              });
              out.push({
                type: 'patch_apply_end',
                turnId,
                callId: itemId,
                files,
                ok: item.status === 'completed',
                at,
              });
            }
            break;
          case 'todo_list': {
            const items: TodoEntry[] = (Array.isArray(item.items) ? item.items : []).map((entry) => {
              const value = asRecord(entry);
              return {
                text: String(value?.text ?? ''),
                completed: value?.completed === true,
              };
            });
            out.push({ type: 'todo_list', turnId, itemId, items, at });
            break;
          }
          case 'error':
            if (lifecycle === 'completed') {
              out.push({
                type: 'error_item',
                turnId,
                itemId,
                message: String(item.message ?? ''),
                at,
              });
            }
            break;
          default:
            out.push({ type: 'raw', turnId, itemId, payload: line, at });
        }

        if (lifecycle === 'completed') completedItems.add(itemId);
        break;
      }

      default:
        out.push({
          type: 'raw',
          ...(currentTurnId ? { turnId: currentTurnId } : {}),
          payload: line,
          at,
        });
    }
  });

  return out;
}
