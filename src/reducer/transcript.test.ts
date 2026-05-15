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
