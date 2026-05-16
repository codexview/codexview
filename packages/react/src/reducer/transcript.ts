import type { ChatStreamEvent } from '../types/events.js';
import type { ItemStatus, ItemView, TranscriptModel, TurnView } from '../types/model.js';
import { EMPTY_MODEL } from '../types/model.js';

function findTurnIndex(model: TranscriptModel, turnId: string): number {
  for (let i = model.turns.length - 1; i >= 0; i -= 1) {
    if (model.turns[i]!.turnId === turnId) return i;
  }
  return -1;
}

function replaceTurn(model: TranscriptModel, index: number, turn: TurnView, at: number): TranscriptModel {
  const turns = model.turns.slice();
  turns[index] = turn;
  return { ...model, turns, lastEventAt: at };
}

function flipUnfinished(items: ItemView[], next: ItemStatus): ItemView[] {
  return items.map((item) =>
    item.status === 'pending' || item.status === 'running' ? { ...item, status: next, updatedAt: item.updatedAt } : item,
  );
}

function withinTurn(
  prev: TranscriptModel,
  turnId: string,
  at: number,
  mut: (turn: TurnView) => TurnView,
): TranscriptModel {
  const i = findTurnIndex(prev, turnId);
  if (i < 0) return { ...prev, lastEventAt: at };
  return replaceTurn(prev, i, mut(prev.turns[i]!), at);
}

function appendItem(turn: TurnView, item: ItemView): TurnView {
  return { ...turn, items: [...turn.items, item] };
}

function updateItem(turn: TurnView, id: string, mut: (item: ItemView) => ItemView): TurnView {
  let touched = false;
  const items = turn.items.map((it) => {
    if (it.id !== id) return it;
    touched = true;
    return mut(it);
  });
  return touched ? { ...turn, items } : turn;
}

export function reduceTranscript(prev: TranscriptModel, event: ChatStreamEvent): TranscriptModel {
  switch (event.type) {
    case 'thread_started':
      return { ...prev, threadId: event.threadId, lastEventAt: event.at };

    case 'turn_started': {
      const turn: TurnView = {
        turnId: event.turnId,
        startedAt: event.at,
        status: 'running',
        items: [],
      };
      return { ...prev, turns: [...prev.turns, turn], lastEventAt: event.at };
    }

    case 'turn_completed': {
      const i = findTurnIndex(prev, event.turnId);
      if (i < 0) return { ...prev, lastEventAt: event.at };
      const t = prev.turns[i]!;
      const turn: TurnView = {
        ...t,
        status: 'completed',
        completedAt: event.at,
        items: flipUnfinished(t.items, 'completed'),
      };
      if (event.usage !== undefined) turn.usage = event.usage;
      return replaceTurn(prev, i, turn, event.at);
    }

    case 'turn_failed': {
      const i = findTurnIndex(prev, event.turnId);
      if (i < 0) return { ...prev, lastEventAt: event.at };
      const t = prev.turns[i]!;
      return replaceTurn(prev, i, {
        ...t,
        status: 'failed',
        completedAt: event.at,
        error: event.error,
        items: flipUnfinished(t.items, 'failed'),
      }, event.at);
    }

    case 'turn_aborted': {
      const i = findTurnIndex(prev, event.turnId);
      if (i < 0) return { ...prev, lastEventAt: event.at };
      const t = prev.turns[i]!;
      return replaceTurn(prev, i, {
        ...t,
        status: 'aborted',
        completedAt: event.at,
        items: flipUnfinished(t.items, 'stopped'),
      }, event.at);
    }

    case 'user_message':
      return withinTurn(prev, event.turnId, event.at, (t) =>
        appendItem(t, {
          id: event.itemId,
          kind: 'user_message',
          status: 'completed',
          startedAt: event.at,
          updatedAt: event.at,
          text: event.text,
        }),
      );

    case 'agent_message':
    case 'reasoning': {
      const kind = event.type === 'reasoning' ? 'reasoning' : 'assistant_text';
      return withinTurn(prev, event.turnId, event.at, (t) => {
        const exists = t.items.some((it) => it.id === event.itemId && it.kind === kind);
        if (exists) {
          return updateItem(t, event.itemId, (it) => {
            if (it.kind !== kind) return it;
            return { ...it, text: event.text, status: event.partial ? 'running' : 'completed', updatedAt: event.at };
          });
        }
        return appendItem(t, {
          id: event.itemId,
          kind,
          status: event.partial ? 'running' : 'completed',
          startedAt: event.at,
          updatedAt: event.at,
          text: event.text,
        } as ItemView);
      });
    }

    case 'function_call':
    case 'mcp_tool_call':
      return withinTurn(prev, event.turnId, event.at, (t) =>
        appendItem(t, {
          id: event.callId,
          kind: 'tool_call',
          status: 'pending',
          startedAt: event.at,
          updatedAt: event.at,
          name: event.name,
          ...(event.type === 'mcp_tool_call' ? { server: event.server } : {}),
          args: event.args,
        } as ItemView),
      );

    case 'function_call_output':
    case 'mcp_tool_call_output':
      return withinTurn(prev, event.turnId, event.at, (t) =>
        updateItem(t, event.callId, (it) => {
          if (it.kind !== 'tool_call') return it;
          if (event.error !== undefined) {
            return { ...it, status: 'failed' as const, updatedAt: event.at, error: event.error };
          }
          return { ...it, status: 'completed' as const, updatedAt: event.at, result: event.output };
        }),
      );

    case 'exec_command_begin':
      return withinTurn(prev, event.turnId, event.at, (t) =>
        appendItem(t, {
          id: event.callId,
          kind: 'exec',
          status: 'running',
          startedAt: event.at,
          updatedAt: event.at,
          command: event.command,
        }),
      );

    case 'exec_command_end':
      return withinTurn(prev, event.turnId, event.at, (t) =>
        updateItem(t, event.callId, (it) => {
          if (it.kind !== 'exec') return it;
          return {
            ...it,
            status: event.exit === 0 ? 'completed' : 'failed',
            updatedAt: event.at,
            exit: event.exit,
            stdout: event.stdout,
            stderr: event.stderr,
            durationMs: event.durationMs,
          };
        }),
      );

    case 'web_search_call':
      return withinTurn(prev, event.turnId, event.at, (t) =>
        appendItem(t, {
          id: event.callId,
          kind: 'search',
          status: 'pending',
          startedAt: event.at,
          updatedAt: event.at,
          query: event.query,
        }),
      );

    case 'web_search_end':
      return withinTurn(prev, event.turnId, event.at, (t) =>
        updateItem(t, event.callId, (it) => {
          if (it.kind !== 'search') return it;
          return { ...it, status: 'completed', updatedAt: event.at, results: event.results };
        }),
      );

    case 'patch_apply_end':
      return withinTurn(prev, event.turnId, event.at, (t) =>
        appendItem(t, {
          id: event.callId,
          kind: 'patch',
          status: event.ok ? 'completed' : 'failed',
          startedAt: event.at,
          updatedAt: event.at,
          files: event.files,
          ok: event.ok,
        }),
      );

    case 'todo_list':
      // Plan / TODO list — itemId-keyed so subsequent updates replace in place.
      return withinTurn(prev, event.turnId, event.at, (t) => {
        const exists = t.items.some((it) => it.id === event.itemId && it.kind === 'todo_list');
        const allDone = event.items.length > 0 && event.items.every((e) => e.completed);
        const status: ItemStatus = allDone ? 'completed' : 'running';
        if (exists) {
          return updateItem(t, event.itemId, (it) => {
            if (it.kind !== 'todo_list') return it;
            return { ...it, items: event.items, updatedAt: event.at, status };
          });
        }
        return appendItem(t, {
          id: event.itemId,
          kind: 'todo_list',
          status,
          startedAt: event.at,
          updatedAt: event.at,
          items: event.items,
        });
      });

    case 'error_item':
      // Non-fatal item-level error (separate from turn_failed).
      return withinTurn(prev, event.turnId, event.at, (t) =>
        appendItem(t, {
          id: event.itemId,
          kind: 'error',
          status: 'failed',
          startedAt: event.at,
          updatedAt: event.at,
          message: event.message,
        }),
      );

    case 'raw': {
      if (!event.turnId) return { ...prev, lastEventAt: event.at };
      return withinTurn(prev, event.turnId, event.at, (t) =>
        appendItem(t, {
          id: event.itemId ?? `raw-${t.items.length}`,
          kind: 'raw',
          status: 'completed',
          startedAt: event.at,
          updatedAt: event.at,
          payload: event.payload,
        }),
      );
    }

    default: {
      const e = event as { turnId?: string; at?: number; type?: string; [k: string]: unknown };
      const at = typeof e.at === 'number' ? e.at : prev.lastEventAt;
      if (!e.turnId) return { ...prev, lastEventAt: at };
      return withinTurn(prev, e.turnId, at, (t) =>
        appendItem(t, {
          id: `raw-${t.items.length}`,
          kind: 'raw',
          status: 'completed',
          startedAt: at,
          updatedAt: at,
          payload: e,
        }),
      );
    }
  }
}

export { EMPTY_MODEL };
