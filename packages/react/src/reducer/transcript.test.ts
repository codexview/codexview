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

  it('preserves assistant message phase metadata', () => {
    const m = reduceTranscript(startedTurn(), {
      type: 'agent_message',
      turnId: 'tn-1',
      itemId: 'a1',
      text: 'working',
      partial: false,
      phase: 'commentary',
      at: 120,
    });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'assistant_text', phase: 'commentary' });
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

describe('reduceTranscript / tool calls and exec', () => {
  const start = () => reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 100 });

  it('function_call creates pending tool_call', () => {
    const m = reduceTranscript(start(), {
      type: 'function_call',
      turnId: 'tn-1',
      callId: 'c1',
      name: 'getWeather',
      args: { city: 'NYC' },
      at: 110,
    });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'tool_call', id: 'c1', name: 'getWeather', status: 'pending' });
  });

  it('function_call_output completes the matching tool_call', () => {
    let m = start();
    m = reduceTranscript(m, { type: 'function_call', turnId: 'tn-1', callId: 'c1', name: 'x', args: {}, at: 110 });
    m = reduceTranscript(m, { type: 'function_call_output', turnId: 'tn-1', callId: 'c1', output: { ok: true }, at: 120 });
    expect(m.turns[0]?.items[0]).toMatchObject({ status: 'completed', result: { ok: true } });
  });

  it('function_call_output with error marks failed', () => {
    let m = start();
    m = reduceTranscript(m, { type: 'function_call', turnId: 'tn-1', callId: 'c1', name: 'x', args: {}, at: 110 });
    m = reduceTranscript(m, { type: 'function_call_output', turnId: 'tn-1', callId: 'c1', error: 'boom', at: 120 });
    expect(m.turns[0]?.items[0]).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('exec_command_begin creates a running exec', () => {
    const m = reduceTranscript(start(), {
      type: 'exec_command_begin',
      turnId: 'tn-1',
      callId: 'e1',
      command: 'ls',
      at: 110,
    });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'exec', id: 'e1', command: 'ls', status: 'running' });
  });

  it('exec_command_end with exit=0 completes; non-zero fails', () => {
    let m = reduceTranscript(start(), { type: 'exec_command_begin', turnId: 'tn-1', callId: 'e1', command: 'ls', at: 110 });
    m = reduceTranscript(m, { type: 'exec_command_end', turnId: 'tn-1', callId: 'e1', exit: 0, stdout: 'a\nb', stderr: '', durationMs: 5, at: 120 });
    expect(m.turns[0]?.items[0]).toMatchObject({ status: 'completed', exit: 0, stdout: 'a\nb', durationMs: 5 });

    let m2 = reduceTranscript(start(), { type: 'exec_command_begin', turnId: 'tn-1', callId: 'e2', command: 'false', at: 110 });
    m2 = reduceTranscript(m2, { type: 'exec_command_end', turnId: 'tn-1', callId: 'e2', exit: 1, stdout: '', stderr: 'no', durationMs: 1, at: 120 });
    expect(m2.turns[0]?.items[0]).toMatchObject({ status: 'failed', exit: 1, stderr: 'no' });
  });

  it('output without prior call is ignored gracefully (no throw, no item added)', () => {
    const m = reduceTranscript(start(), { type: 'function_call_output', turnId: 'tn-1', callId: 'missing', output: {}, at: 110 });
    expect(m.turns[0]?.items).toHaveLength(0);
  });
});

describe('reduceTranscript / search, patch, raw', () => {
  const start = () => reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 100 });

  it('web_search_call then web_search_end completes', () => {
    let m = reduceTranscript(start(), { type: 'web_search_call', turnId: 'tn-1', callId: 's1', query: 'ts', at: 110 });
    m = reduceTranscript(m, { type: 'web_search_end', turnId: 'tn-1', callId: 's1', results: [{ title: 'T', url: 'https://x' }], at: 120 });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'search', status: 'completed', results: [{ title: 'T', url: 'https://x' }] });
  });

  it('patch_apply_end ok=true => completed; ok=false => failed', () => {
    const ok = reduceTranscript(start(), {
      type: 'patch_apply_end', turnId: 'tn-1', callId: 'p1', files: [{ path: 'a.ts', status: 'modified' }], ok: true, at: 110,
    });
    expect(ok.turns[0]?.items[0]).toMatchObject({ kind: 'patch', status: 'completed', ok: true });

    const fail = reduceTranscript(start(), {
      type: 'patch_apply_end', turnId: 'tn-1', callId: 'p2', files: [], ok: false, at: 110,
    });
    expect(fail.turns[0]?.items[0]).toMatchObject({ kind: 'patch', status: 'failed', ok: false });
  });

  it('raw event is appended as kind=raw with payload preserved', () => {
    const m = reduceTranscript(start(), { type: 'raw', turnId: 'tn-1', payload: { foo: 1 }, at: 110 });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'raw', payload: { foo: 1 }, status: 'completed' });
  });

  it('raw event with no turnId is dropped silently (lastEventAt still updates)', () => {
    const m = reduceTranscript(EMPTY_MODEL, { type: 'raw', payload: { lone: true }, at: 50 });
    expect(m.turns).toEqual([]);
    expect(m.lastEventAt).toBe(50);
  });

  it('unknown event-shaped object is treated as raw via TS escape hatch', () => {
    const unknownEvent = { type: 'foobar', turnId: 'tn-1', at: 110, payload: 1 } as unknown as Parameters<typeof reduceTranscript>[1];
    const m = reduceTranscript(start(), unknownEvent);
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'raw' });
  });
});
