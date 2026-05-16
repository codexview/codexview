import { useMemo, useRef } from 'react';
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
  const cacheRef = useRef<CacheEntry>({ events: [], model: EMPTY_MODEL });

  const model = useMemo(() => {
    const cache = cacheRef.current;
    const isPrefix =
      events.length >= cache.events.length &&
      cache.events.every((e, i) => e === events[i]);

    let next: TranscriptModel;
    let startIdx: number;

    if (isPrefix) {
      next = cache.model;
      startIdx = cache.events.length;
    } else {
      next = EMPTY_MODEL;
      startIdx = 0;
    }

    for (let i = startIdx; i < events.length; i += 1) {
      const ev = events[i];
      if (ev == null || typeof ev !== 'object') {
        options.onInternalError?.(new TypeError('non-object event'), ev as unknown as ChatStreamEvent);
        continue;
      }
      next = safeReduce(next, ev, options.onInternalError);
    }

    cacheRef.current = { events, model: next };
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const status = options.status ?? inferStatus(model);
  return { model, status };
}
