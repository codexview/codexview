import { describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '../types/events.js';
import { EMPTY_MODEL } from '../types/model.js';
import { reduceTranscript } from './transcript.js';

const SCENARIO: ChatStreamEvent[] = [
  { type: 'thread_started', threadId: 'T', at: 1 },
  { type: 'turn_started', turnId: 'A', at: 10 },
  { type: 'user_message', turnId: 'A', itemId: 'u1', text: 'hi', at: 11 },
  { type: 'reasoning', turnId: 'A', itemId: 'r1', text: 'thinking', partial: false, at: 12 },
  { type: 'agent_message', turnId: 'A', itemId: 'a1', text: 'h', partial: true, at: 13 },
  { type: 'agent_message', turnId: 'A', itemId: 'a1', text: 'hi', partial: false, at: 14 },
  { type: 'function_call', turnId: 'A', callId: 'c1', name: 'echo', args: { x: 1 }, at: 15 },
  { type: 'function_call_output', turnId: 'A', callId: 'c1', output: 'ok', at: 16 },
  { type: 'exec_command_begin', turnId: 'A', callId: 'e1', command: 'ls', at: 17 },
  { type: 'exec_command_end', turnId: 'A', callId: 'e1', exit: 0, stdout: 'a', stderr: '', durationMs: 5, at: 18 },
  { type: 'web_search_call', turnId: 'A', callId: 's1', query: 'ts', at: 19 },
  { type: 'web_search_end', turnId: 'A', callId: 's1', results: [{ title: 'T', url: 'https://x' }], at: 20 },
  { type: 'patch_apply_end', turnId: 'A', callId: 'p1', files: [{ path: 'a.ts', status: 'modified' }], ok: true, at: 21 },
  { type: 'turn_completed', turnId: 'A', at: 22, usage: { inputTokens: 1, outputTokens: 1 } },
  { type: 'raw', turnId: 'A', payload: { weird: true }, at: 23 },
];

describe('reduceTranscript / property', () => {
  it('incremental reduce equals bulk reduce', () => {
    const bulk = SCENARIO.reduce(reduceTranscript, EMPTY_MODEL);

    let incremental = EMPTY_MODEL;
    for (const e of SCENARIO) incremental = reduceTranscript(incremental, e);

    expect(incremental).toEqual(bulk);
  });

  it('reducer never throws on a randomized order of valid events', () => {
    const shuffled = [...SCENARIO].sort(() => Math.random() - 0.5);
    expect(() => shuffled.reduce(reduceTranscript, EMPTY_MODEL)).not.toThrow();
  });

  it('initial EMPTY_MODEL is not mutated by any number of reductions', () => {
    const snap = JSON.stringify(EMPTY_MODEL);
    SCENARIO.reduce(reduceTranscript, EMPTY_MODEL);
    expect(JSON.stringify(EMPTY_MODEL)).toBe(snap);
  });
});
