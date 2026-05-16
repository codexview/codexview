import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '../types/events.js';
import { useCodexTranscript } from './useCodexTranscript.js';

const baseEvents: ChatStreamEvent[] = [
  { type: 'thread_started', threadId: 'T', at: 1 },
  { type: 'turn_started', turnId: 'A', at: 2 },
  { type: 'agent_message', turnId: 'A', itemId: 'a', text: 'hi', partial: false, at: 3 },
  { type: 'turn_completed', turnId: 'A', at: 4 },
];

describe('useCodexTranscript', () => {
  it('returns model and inferred status from events', () => {
    const { result } = renderHook(() => useCodexTranscript(baseEvents));
    expect(result.current.model.threadId).toBe('T');
    expect(result.current.model.turns).toHaveLength(1);
    expect(result.current.status).toBe('completed');
  });

  it('explicit status overrides inference', () => {
    const { result } = renderHook(() => useCodexTranscript(baseEvents, { status: 'stopped' }));
    expect(result.current.status).toBe('stopped');
  });

  it('append-only updates do incremental reduce (model identity changes only on change)', () => {
    const { result, rerender } = renderHook(({ ev }: { ev: ChatStreamEvent[] }) => useCodexTranscript(ev), {
      initialProps: { ev: baseEvents },
    });
    const before = result.current.model;
    rerender({ ev: baseEvents }); // same array reference
    expect(result.current.model).toBe(before);

    const more: ChatStreamEvent[] = [...baseEvents, { type: 'turn_started', turnId: 'B', at: 5 }];
    rerender({ ev: more });
    expect(result.current.model.turns).toHaveLength(2);
  });

  it('non-prefix change triggers full re-reduce', () => {
    const { result, rerender } = renderHook(({ ev }: { ev: ChatStreamEvent[] }) => useCodexTranscript(ev), {
      initialProps: { ev: baseEvents },
    });
    const replaced: ChatStreamEvent[] = [{ type: 'thread_started', threadId: 'OTHER', at: 1 }];
    rerender({ ev: replaced });
    expect(result.current.model.threadId).toBe('OTHER');
    expect(result.current.model.turns).toHaveLength(0);
  });

  it('reducer error is captured by onInternalError and last good model is preserved', () => {
    const onErr = vi.fn();
    const ev: ChatStreamEvent[] = [
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'agent_message', turnId: 'A', itemId: 'm', text: 'ok', partial: false, at: 2 },
    ];
    const { result, rerender } = renderHook(({ events }: { events: ChatStreamEvent[] }) =>
      useCodexTranscript(events, { onInternalError: onErr }),
      { initialProps: { events: ev } });
    expect(result.current.model.turns[0]?.items).toHaveLength(1);

    // Inject a bad event by mocking reduce internally is hard; emulate by passing a non-object-shaped raw.
    const bad = [...ev, null as unknown as ChatStreamEvent];
    act(() => rerender({ events: bad }));
    expect(onErr).toHaveBeenCalled();
    // Model should remain valid (one turn one item from the good prefix).
    expect(result.current.model.turns[0]?.items).toHaveLength(1);
  });
});
