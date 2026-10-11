import { useRef } from 'react';
import type { ChatStreamEvent } from '../types/events.js';
import type { TranscriptModel, TranscriptStatus } from '../types/model.js';
import { EMPTY_MODEL } from '../types/model.js';
import { reduceTranscript } from '../reducer/transcript.js';
import { inferStatus } from '../reducer/status.js';

export interface UseCodexTranscriptOptions {
  status?: TranscriptStatus;
  onInternalError?: (err: unknown, event?: ChatStreamEvent) => void;
}

interface CacheEntry {
  events: ChatStreamEvent[];
  model: TranscriptModel;
  tailStart: number;
  tailBase: TranscriptModel;
}

function safeReduce(
  prev: TranscriptModel,
  event: ChatStreamEvent,
  onError?: (err: unknown, event?: ChatStreamEvent) => void,
): TranscriptModel {
  try {
    return reduceTranscript(prev, event);
  } catch (err) {
    onError?.(err, event);
    return prev;
  }
}

export function useCodexTranscript(
  events: ChatStreamEvent[],
  options: UseCodexTranscriptOptions = {},
): { model: TranscriptModel; status: TranscriptStatus } {
  const cacheRef = useRef<CacheEntry>({ events: [], model: EMPTY_MODEL, tailStart: 0, tailBase: EMPTY_MODEL });

  // Compare copied references on every render: callers may append to the same array.
  // Keep one checkpoint before the last turn, avoiding per-event historical models.
  // A materialized live item replacement only replays that turn's events.
  const cache = cacheRef.current;
  let prefix = 0;
  while (prefix < events.length && prefix < cache.events.length && events[prefix] === cache.events[prefix]) prefix++;
  const append = prefix === cache.events.length;
  const reuseTail = !append && prefix >= cache.tailStart;
  let start = append ? prefix : reuseTail ? cache.tailStart : 0;
  let model = append ? cache.model : reuseTail ? cache.tailBase : EMPTY_MODEL;
  let tailStart = append || reuseTail ? cache.tailStart : 0;
  let tailBase = append || reuseTail ? cache.tailBase : EMPTY_MODEL;
  for (let i = start; i < events.length; i++) {
    const event = events[i];
    if (event == null || typeof event !== 'object') {
      options.onInternalError?.(new TypeError('non-object event'), event as unknown as ChatStreamEvent);
    } else {
      if (event.type === 'turn_started') { tailStart = i; tailBase = model; }
      model = safeReduce(model, event, options.onInternalError);
    }
  }
  cacheRef.current = { events: events.slice(), model, tailStart, tailBase };

  const status = options.status ?? inferStatus(model);
  return { model, status };
}
