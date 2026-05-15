import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL } from '../types/model.js';
import { reduceTranscript } from './transcript.js';

describe('reduceTranscript / lifecycle', () => {
  it('thread_started sets threadId', () => {
    const next = reduceTranscript(EMPTY_MODEL, {
      type: 'thread_started',
      threadId: 't-1',
      at: 100,
    });
    expect(next.threadId).toBe('t-1');
    expect(next.turns).toEqual([]);
    expect(next.lastEventAt).toBe(100);
  });

  it('turn_started appends a running turn', () => {
    const next = reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 200 });
    expect(next.turns).toHaveLength(1);
    expect(next.turns[0]).toMatchObject({ turnId: 'tn-1', status: 'running', startedAt: 200, items: [] });
  });

  it('turn_completed marks turn completed and writes usage', () => {
    const m1 = reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 200 });
    const m2 = reduceTranscript(m1, {
      type: 'turn_completed',
      turnId: 'tn-1',
      at: 300,
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    expect(m2.turns[0]?.status).toBe('completed');
    expect(m2.turns[0]?.completedAt).toBe(300);
    expect(m2.turns[0]?.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('turn_failed marks turn failed and stores error', () => {
    const m1 = reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 200 });
    const m2 = reduceTranscript(m1, {
      type: 'turn_failed',
      turnId: 'tn-1',
      at: 300,
      error: { message: 'boom', code: 'E1' },
    });
    expect(m2.turns[0]?.status).toBe('failed');
    expect(m2.turns[0]?.error).toEqual({ message: 'boom', code: 'E1' });
  });

  it('turn_aborted marks turn aborted', () => {
    const m1 = reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 200 });
    const m2 = reduceTranscript(m1, { type: 'turn_aborted', turnId: 'tn-1', at: 300 });
    expect(m2.turns[0]?.status).toBe('aborted');
  });

  it('reducer is pure: input model is not mutated', () => {
    const before = JSON.stringify(EMPTY_MODEL);
    reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 1 });
    expect(JSON.stringify(EMPTY_MODEL)).toBe(before);
  });
});

describe('reduceTranscript / messages', () => {
  function startedTurn() {
    return reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 100 });
  }

  it('user_message appends a completed user item', () => {
    const m = reduceTranscript(startedTurn(), {
      type: 'user_message',
      turnId: 'tn-1',
      itemId: 'u1',
      text: 'hi',
      at: 110,
    });
    const item = m.turns[0]?.items[0];
    expect(item).toMatchObject({ kind: 'user_message', id: 'u1', text: 'hi', status: 'completed' });
  });

  it('agent_message partial creates a running assistant_text item', () => {
    const m = reduceTranscript(startedTurn(), {
      type: 'agent_message',
      turnId: 'tn-1',
      itemId: 'a1',
      text: 'hel',
      partial: true,
      at: 120,
    });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'assistant_text', id: 'a1', text: 'hel', status: 'running' });
  });

  it('agent_message updates same itemId and flips to completed when partial=false', () => {
    let m = startedTurn();
    m = reduceTranscript(m, { type: 'agent_message', turnId: 'tn-1', itemId: 'a1', text: 'hel', partial: true, at: 120 });
    m = reduceTranscript(m, { type: 'agent_message', turnId: 'tn-1', itemId: 'a1', text: 'hello', partial: false, at: 130 });
    expect(m.turns[0]?.items).toHaveLength(1);
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'assistant_text', text: 'hello', status: 'completed' });
  });

  it('reasoning is independent from agent_message (not merged)', () => {
    let m = startedTurn();
    m = reduceTranscript(m, { type: 'reasoning', turnId: 'tn-1', itemId: 'r1', text: 'think', partial: false, at: 115 });
    m = reduceTranscript(m, { type: 'agent_message', turnId: 'tn-1', itemId: 'a1', text: 'answer', partial: false, at: 120 });
    expect(m.turns[0]?.items).toHaveLength(2);
    expect(m.turns[0]?.items[0]?.kind).toBe('reasoning');
    expect(m.turns[0]?.items[1]?.kind).toBe('assistant_text');
  });
});
