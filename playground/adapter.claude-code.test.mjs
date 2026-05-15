import { describe, it, expect } from 'vitest';
import { adapt } from './adapter.mjs';

describe('detectFormat (via adapt)', () => {
  it("returns format='claude-code' for Claude Code JSONL", () => {
    const lines = [
      { type: 'user', uuid: 'u1', sessionId: 's1', parentUuid: null, timestamp: '2026-05-15T00:00:00Z',
        message: { role: 'user', content: 'hi' } },
    ];
    const { format } = adapt(lines);
    expect(format).toBe('claude-code');
  });

  it("returns format='claude-code' when queue-operation lines precede conversation lines", () => {
    // Real Claude Code JSONL files begin with queue-operation lines that
    // carry only type+timestamp+sessionId — no uuid/parentUuid. The detector
    // must still classify the file as claude-code, not as a Codex rollout.
    const lines = [
      { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-05-15T00:00:00Z',
        sessionId: 's1', content: 'queued' },
      { type: 'user', uuid: 'u1', sessionId: 's1', parentUuid: null,
        timestamp: '2026-05-15T00:00:01Z', message: { role: 'user', content: 'hi' } },
    ];
    expect(adapt(lines).format).toBe('claude-code');
  });

  it("still returns format='rollout' for Codex CLI JSONL", () => {
    const lines = [
      { type: 'session_meta', timestamp: '2026-05-15T00:00:00Z', payload: { id: 'thread-x' } },
    ];
    const { format } = adapt(lines);
    expect(format).toBe('rollout');
  });

  it("returns format='unknown' for empty input", () => {
    expect(adapt([]).format).toBe('unknown');
  });
});

describe('adaptClaudeCode · thread', () => {
  it('emits thread_started with sessionId from first line', () => {
    const lines = [
      { type: 'attachment', uuid: 'a1', sessionId: 'sess-abc', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', attachment: { type: 'hook_success' } },
    ];
    const { events } = adapt(lines);
    expect(events[0]).toMatchObject({ type: 'thread_started', threadId: 'sess-abc' });
    expect(typeof events[0].at).toBe('number');
  });

  it('emits thread_started only once even across many lines', () => {
    const lines = [
      { type: 'attachment', uuid: 'a1', sessionId: 'sess-X', parentUuid: null, timestamp: '2026-05-15T00:00:00Z', attachment: { type: 'hook_success' } },
      { type: 'attachment', uuid: 'a2', sessionId: 'sess-X', parentUuid: 'a1', timestamp: '2026-05-15T00:00:01Z', attachment: { type: 'hook_success' } },
    ];
    const { events } = adapt(lines);
    const threadStarts = events.filter((e) => e.type === 'thread_started');
    expect(threadStarts).toHaveLength(1);
  });
});

describe('adaptClaudeCode · filtering', () => {
  it('drops attachment / system / last-prompt / queue-operation (only thread_started emits)', () => {
    const base = { uuid: 'u1', sessionId: 'sess', parentUuid: null, timestamp: '2026-05-15T00:00:00Z' };
    const lines = [
      { ...base, type: 'attachment', attachment: { type: 'hook_success' } },
      { ...base, type: 'system', uuid: 'u2', content: 'whatever' },
      { ...base, type: 'last-prompt', uuid: 'u3', lastPrompt: 'draft' },
      { ...base, type: 'queue-operation', uuid: 'u4', operation: 'enqueue', content: 'queued' },
    ];
    const { events } = adapt(lines);
    expect(events.map((e) => e.type)).toEqual(['thread_started']);
  });

  it('drops lines where isSidechain === true entirely (even the first one)', () => {
    const lines = [
      { type: 'user', uuid: 'u1', sessionId: 'sess', parentUuid: null, isSidechain: true,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'side' } },
      { type: 'attachment', uuid: 'a1', sessionId: 'sess', parentUuid: null, isSidechain: false,
        timestamp: '2026-05-15T00:00:01Z', attachment: { type: 'hook_success' } },
    ];
    const { events } = adapt(lines);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'thread_started', threadId: 'sess' });
  });
});

describe('adaptClaudeCode · text-user (turn boundary)', () => {
  it('emits turn_started + user_message for a string-content user message', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'hello' } },
    ];
    const { events } = adapt(lines);
    expect(events.map((e) => e.type)).toEqual(['thread_started', 'turn_started', 'user_message']);
    expect(events[1]).toMatchObject({ turnId: 'u-1' });
    expect(events[2]).toMatchObject({ turnId: 'u-1', itemId: 'u-1', text: 'hello' });
  });

  it('treats user with content[]={type:"text",text:...} as a text-user too', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'multiline' }] } },
    ];
    const { events } = adapt(lines);
    const userMsgs = events.filter((e) => e.type === 'user_message');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]).toMatchObject({ text: 'multiline', itemId: 'u-1:0' });
  });

  it('does NOT open a new turn for user content that is a tool_result', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    ];
    const { events } = adapt(lines);
    expect(events.find((e) => e.type === 'turn_started')).toBeUndefined();
    expect(events.find((e) => e.type === 'user_message')).toBeUndefined();
  });
});
