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

    default:
      return { ...prev, lastEventAt: event.at };
  }
}

export { EMPTY_MODEL };
