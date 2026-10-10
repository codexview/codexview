import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '../types/events.js';
import { useCodexTranscript } from './useCodexTranscript.js';

describe('useCodexTranscript mutable array compatibility', () => {
  it('detects appends and item replacements using the same array', () => {
    const events: ChatStreamEvent[] = [{ type: 'turn_started', turnId: 'turn', at: 1 }];
    const { result, rerender } = renderHook(() => useCodexTranscript(events));
    events.push({ type: 'agent_message', turnId: 'turn', itemId: 'item', text: 'first', partial: true, at: 2 });
    rerender();
    expect(result.current.model.turns[0]?.items[0]).toMatchObject({ text: 'first' });
    events[1] = { type: 'agent_message', turnId: 'turn', itemId: 'item', text: 'replacement', partial: true, at: 3 };
    rerender();
    expect(result.current.model.turns[0]?.items).toHaveLength(1);
    expect(result.current.model.turns[0]?.items[0]).toMatchObject({ text: 'replacement' });
    events.length = 1;
    rerender();
    expect(result.current.model.turns[0]?.items).toHaveLength(0);
  });
});
