import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { adapt } from './adapter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const readFixture = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
const readMeta = (rel) => JSON.parse(readFileSync(resolve(repoRoot, rel), 'utf8'));

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
    expect(events.map((e) => e.type)).toEqual(['thread_started', 'turn_started', 'user_message', 'turn_completed']);
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

describe('adaptClaudeCode · multi-turn', () => {
  it('closes the previous turn before opening a new one', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'first' } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:01:00Z', message: { role: 'user', content: 'second' } },
    ];
    const { events } = adapt(lines);
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'thread_started',
      'turn_started', 'user_message',     // first turn opens
      'turn_completed',                    // first turn closes
      'turn_started', 'user_message',     // second turn opens
      'turn_completed',                    // second turn closes at EOF
    ]);
    expect(events[3]).toMatchObject({ type: 'turn_completed', turnId: 'u-1' });
    expect(events[4]).toMatchObject({ type: 'turn_started', turnId: 'u-2' });
  });
});

describe('adaptClaudeCode · EOF closure', () => {
  it('closes a dangling turn at end-of-file', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'only' } },
    ];
    const { events } = adapt(lines);
    expect(events[events.length - 1]).toMatchObject({ type: 'turn_completed', turnId: 'u-1' });
  });

  it('does not emit a stray turn_completed when there were no turns', () => {
    const lines = [
      { type: 'attachment', uuid: 'a1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', attachment: { type: 'hook_success' } },
    ];
    const { events } = adapt(lines);
    expect(events.some((e) => e.type === 'turn_completed')).toBe(false);
  });
});

describe('adaptClaudeCode · assistant text', () => {
  it('emits agent_message for each text block in assistant content[]', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', model: 'claude-opus-4-7',
          content: [{ type: 'text', text: 'answer1' }, { type: 'text', text: 'answer2' }],
          usage: { input_tokens: 0, output_tokens: 0 } } },
    ];
    const { events } = adapt(lines);
    const am = events.filter((e) => e.type === 'agent_message');
    expect(am).toHaveLength(2);
    expect(am[0]).toMatchObject({ turnId: 'u-1', itemId: 'a-1:0', text: 'answer1', partial: false });
    expect(am[1]).toMatchObject({ turnId: 'u-1', itemId: 'a-1:1', text: 'answer2', partial: false });
  });

  it('ignores assistant messages that arrive without an open turn', () => {
    const lines = [
      { type: 'assistant', uuid: 'a-orphan', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'orphan' }] } },
    ];
    const { events } = adapt(lines);
    expect(events.some((e) => e.type === 'agent_message')).toBe(false);
  });
});

describe('adaptClaudeCode · thinking', () => {
  it('emits reasoning for non-empty thinking', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant',
          content: [{ type: 'thinking', thinking: 'pondering...', signature: 'sig' }] } },
    ];
    const { events } = adapt(lines);
    const reasoning = events.filter((e) => e.type === 'reasoning');
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]).toMatchObject({ text: 'pondering...', itemId: 'a-1:0', partial: false });
  });

  it('drops thinking blocks whose .thinking is an empty string (encrypted)', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant',
          content: [{ type: 'thinking', thinking: '', signature: 'sig' }] } },
    ];
    const { events } = adapt(lines);
    expect(events.some((e) => e.type === 'reasoning')).toBe(false);
  });
});

describe('adaptClaudeCode · usage', () => {
  it('attaches summed output_tokens and last input_tokens to turn_completed', () => {
    const mkA = (uuid, input, output) => ({
      type: 'assistant', uuid, sessionId: 'sess', parentUuid: null,
      timestamp: '2026-05-15T00:00:01Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'x' }],
        usage: { input_tokens: input, output_tokens: output } },
    });
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'go' } },
      mkA('a-1', 100, 50),
      mkA('a-2', 200, 30),
      mkA('a-3', 250, 20),
    ];
    const { events } = adapt(lines);
    const done = events.find((e) => e.type === 'turn_completed');
    expect(done.usage).toEqual({ inputTokens: 250, outputTokens: 100 });
  });
});

describe('adaptClaudeCode · Bash tool', () => {
  it('maps tool_use(Bash) + tool_result(ok) to exec_command_begin + exec_command_end', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Bash',
            input: { command: 'ls -la', description: 'list' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'total 0\n', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const begin = events.find((e) => e.type === 'exec_command_begin');
    const end = events.find((e) => e.type === 'exec_command_end');
    expect(begin).toMatchObject({ callId: 'tu-1', command: 'ls -la' });
    expect(end).toMatchObject({ callId: 'tu-1', exit: 0, stdout: 'total 0\n', stderr: '' });
  });

  it('maps tool_result(is_error=true) to exit=1 and routes content to stderr', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'false' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'oh no', is_error: true },
        ] } },
    ];
    const { events } = adapt(lines);
    const end = events.find((e) => e.type === 'exec_command_end');
    expect(end).toMatchObject({ exit: 1, stdout: '', stderr: 'oh no' });
  });
});

describe('adaptClaudeCode · TodoWrite', () => {
  it('emits a todo_list with completed=true only for status==="completed"', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'plan it' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'TodoWrite', input: { todos: [
            { content: 'A', status: 'completed', activeForm: 'Doing A' },
            { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
            { content: 'C', status: 'pending', activeForm: 'Doing C' },
          ] } },
        ] } },
    ];
    const { events } = adapt(lines);
    const td = events.find((e) => e.type === 'todo_list');
    expect(td).toMatchObject({
      itemId: 'tu-1',
      turnId: 'u-1',
      items: [
        { text: 'A', completed: true },
        { text: 'B', completed: false },
        { text: 'C', completed: false },
      ],
    });
  });

  it('drops the matching tool_result ack (no extra events)', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'TodoWrite', input: { todos: [] } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'ok', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    // 1 thread_started + 1 turn_started + 1 user_message + 1 todo_list + 1 turn_completed = 5
    expect(events).toHaveLength(5);
  });
});

describe('adaptClaudeCode · Edit', () => {
  it('synthesises patch_apply_end with -/+ diff on tool_result', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Edit',
            input: { file_path: '/p.ts', old_string: 'foo\nbar', new_string: 'baz\nqux' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'edited', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const patch = events.find((e) => e.type === 'patch_apply_end');
    expect(patch).toBeDefined();
    expect(patch).toMatchObject({
      callId: 'tu-1',
      ok: true,
      files: [{ path: '/p.ts', status: 'modified' }],
    });
    expect(patch.files[0].diff).toBe('- foo\n- bar\n+ baz\n+ qux');
  });

  it('sets ok=false when tool_result.is_error is true', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Edit',
            input: { file_path: '/p.ts', old_string: 'x', new_string: 'y' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'not found', is_error: true },
        ] } },
    ];
    const { events } = adapt(lines);
    expect(events.find((e) => e.type === 'patch_apply_end').ok).toBe(false);
  });
});

describe('adaptClaudeCode · Write', () => {
  it('emits patch_apply_end with status="added" and +-prefixed diff', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Write',
            input: { file_path: '/new.ts', content: 'line1\nline2' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'written', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const patch = events.find((e) => e.type === 'patch_apply_end');
    expect(patch.files[0]).toMatchObject({ path: '/new.ts', status: 'added' });
    expect(patch.files[0].diff).toBe('+ line1\n+ line2');
  });
});

describe('adaptClaudeCode · MultiEdit', () => {
  it('joins multiple edits with blank lines and labels them as modified', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'MultiEdit',
            input: { file_path: '/p.ts', edits: [
              { old_string: 'a', new_string: 'A' },
              { old_string: 'b', new_string: 'B' },
            ] } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'done', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const patch = events.find((e) => e.type === 'patch_apply_end');
    expect(patch.files[0].status).toBe('modified');
    expect(patch.files[0].diff).toBe('- a\n+ A\n\n- b\n+ B');
  });
});

describe('adaptClaudeCode · MCP', () => {
  it('parses mcp__server__name into server + name', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'mcp__weather__get_forecast', input: { city: 'AKL' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'rain', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const call = events.find((e) => e.type === 'mcp_tool_call');
    const output = events.find((e) => e.type === 'mcp_tool_call_output');
    expect(call).toMatchObject({ callId: 'tu-1', server: 'weather', name: 'get_forecast', args: { city: 'AKL' } });
    expect(output).toMatchObject({ callId: 'tu-1', output: 'rain' });
    expect(output.error).toBeUndefined();
  });

  it('handles names with three+ segments by treating extras as part of name', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'mcp__foo__bar__baz', input: {} },
        ] } },
    ];
    const { events } = adapt(lines);
    const call = events.find((e) => e.type === 'mcp_tool_call');
    expect(call).toMatchObject({ server: 'foo', name: 'bar__baz' });
  });

  it('routes tool_result with is_error=true into mcp_tool_call_output.error', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'mcp__svc__op', input: {} },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'boom', is_error: true },
        ] } },
    ];
    const { events } = adapt(lines);
    const output = events.find((e) => e.type === 'mcp_tool_call_output');
    expect(output).toMatchObject({ error: 'boom' });
    expect(output.output).toBeUndefined();
  });
});

describe('adaptClaudeCode · function_call fallback', () => {
  it('maps unknown tools (e.g. Read) to function_call', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/x' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'contents', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const call = events.find((e) => e.type === 'function_call');
    const out_ = events.find((e) => e.type === 'function_call_output');
    expect(call).toMatchObject({ callId: 'tu-1', name: 'Read', args: { file_path: '/x' } });
    expect(out_).toMatchObject({ callId: 'tu-1', output: 'contents' });
  });

  it('routes is_error into function_call_output.error', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Glob', input: { pattern: '**/*.ts' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'bad pattern', is_error: true },
        ] } },
    ];
    const { events } = adapt(lines);
    const out_ = events.find((e) => e.type === 'function_call_output');
    expect(out_).toMatchObject({ error: 'bad pattern' });
    expect(out_.output).toBeUndefined();
  });
});

describe('adaptClaudeCode · dangling tool_use', () => {
  it('emits begin but no end when tool_result never arrives before EOF', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-dangling', name: 'Bash', input: { command: 'sleep 99' } },
        ] } },
      // No tool_result line — session was interrupted before completion.
    ];
    const { events } = adapt(lines);
    expect(events.find((e) => e.type === 'exec_command_begin')).toMatchObject({ callId: 'tu-dangling' });
    expect(events.some((e) => e.type === 'exec_command_end')).toBe(false);
    // The trailing turn_completed at EOF still fires so the UI's reducer can flip the item state.
    expect(events[events.length - 1]).toMatchObject({ type: 'turn_completed' });
  });
});

describe('adapt() options.subagents', () => {
  it('passes subagents into adaptClaudeCode only for claude-code format', () => {
    const claudeLines = [
      { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-05-16T00:00:00Z',
        message: { role: 'user', content: 'hi' } },
    ];
    // The subagents argument should be accepted without throwing even when no Task is present.
    const { format, events } = adapt(claudeLines, { subagents: [{ agentId: 'x', meta: null, lines: [] }] });
    expect(format).toBe('claude-code');
    expect(Array.isArray(events)).toBe(true);
  });

  it('is backward-compatible: adapt(lines) still works without options', () => {
    const { format } = adapt([{ type: 'user', sessionId: 's', uuid: 'u', timestamp: '2026-05-16T00:00:00Z',
      message: { role: 'user', content: 'hi' } }]);
    expect(format).toBe('claude-code');
  });
});

describe('Agent tool with subagent', () => {
  it('embeds subagent summary as Markdown in the Agent tool_result output (agentId lookup)', () => {
    const parentLines = [
      // user prompt — opens a turn
      { type: 'user', uuid: 'p1', sessionId: 's1', timestamp: '2026-05-16T00:00:00Z',
        message: { role: 'user', content: 'review the PR' } },
      // assistant Agent tool_use
      { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: '2026-05-16T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'toolu_AGENT1', name: 'Agent',
            input: { description: 'Final PR review', prompt: 'review carefully', subagent_type: 'general-purpose' } },
        ] } },
      // tool_result — carries toolUseResult.agentId at top level (NOT inside message.content)
      { type: 'user', uuid: 'p2', sessionId: 's1', timestamp: '2026-05-16T00:00:50Z',
        toolUseResult: { agentId: 'a0cd8f421e4818b08', agentType: 'general-purpose', status: 'completed' },
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'toolu_AGENT1',
            content: 'Done. PR looks safe to merge.' },
        ] } },
    ];

    const subagent = {
      agentId: 'a0cd8f421e4818b08',
      meta: { agentType: 'general-purpose', description: 'Final PR review' },
      lines: [
        { type: 'user', uuid: 's1u1', parentUuid: null, isSidechain: true,
          promptId: 'prompt-1', agentId: 'a0cd8f421e4818b08',
          timestamp: '2026-05-16T00:00:02Z',
          message: { role: 'user', content: 'review carefully' } },
        { type: 'assistant', uuid: 's1a1', isSidechain: true,
          timestamp: '2026-05-16T00:00:40Z',
          message: { role: 'assistant', content: [
            { type: 'text', text: 'No issues found. 6 commits, all coherent.' },
          ], usage: { input_tokens: 1234, output_tokens: 567 } } },
      ],
    };

    const { events } = adapt(parentLines, { subagents: [subagent] });
    const out = events.find((e) => e.type === 'function_call_output' && e.callId === 'toolu_AGENT1');
    expect(out).toBeTruthy();
    expect(out.output).toContain('Final PR review');
    expect(out.output).toContain('general-purpose');
    expect(out.output).toContain('No issues found');
    expect(out.output).toMatch(/1[,. \s]?234/);
  });

  it('falls back to plain tool_result when no matching subagent is found', () => {
    const parentLines = [
      { type: 'user', uuid: 'p1', sessionId: 's1', timestamp: '2026-05-16T00:00:00Z',
        message: { role: 'user', content: 'go' } },
      { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: '2026-05-16T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'toolu_AGENT2', name: 'Agent',
            input: { description: 'x', prompt: 'y', subagent_type: 'z' } },
        ] } },
      // No toolUseResult on this line — and subagents array is empty → fallback to plain text
      { type: 'user', uuid: 'p2', sessionId: 's1', timestamp: '2026-05-16T00:00:50Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'toolu_AGENT2', content: 'plain result' },
        ] } },
    ];
    const { events } = adapt(parentLines, { subagents: [] });
    const out = events.find((e) => e.type === 'function_call_output' && e.callId === 'toolu_AGENT2');
    expect(out).toBeTruthy();
    expect(out.output).toBe('plain result');
  });

  it('falls back to FIFO when toolUseResult.agentId is missing but a subagent exists', () => {
    const parentLines = [
      { type: 'user', uuid: 'p1', sessionId: 's1', timestamp: '2026-05-16T00:00:00Z',
        message: { role: 'user', content: 'go' } },
      { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: '2026-05-16T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'toolu_AGENT3', name: 'Agent',
            input: { description: 'Legacy', prompt: 'old-format', subagent_type: 'general-purpose' } },
        ] } },
      // No toolUseResult.agentId on the user line — simulates older sessions or format drift.
      { type: 'user', uuid: 'p2', sessionId: 's1', timestamp: '2026-05-16T00:00:50Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'toolu_AGENT3', content: 'raw output' },
        ] } },
    ];
    const subagent = {
      agentId: 'legacy123',
      meta: { agentType: 'general-purpose', description: 'Legacy' },
      lines: [
        { type: 'assistant', uuid: 's1', isSidechain: true,
          timestamp: '2026-05-16T00:00:40Z',
          message: { role: 'assistant', content: [
            { type: 'text', text: 'Done via FIFO.' },
          ] } },
      ],
    };
    const { events } = adapt(parentLines, { subagents: [subagent] });
    const out = events.find((e) => e.type === 'function_call_output' && e.callId === 'toolu_AGENT3');
    expect(out).toBeTruthy();
    expect(out.output).toContain('Done via FIFO');
    expect(out.output).toContain('Legacy');
  });
});

describe('subagent fixture replay', () => {
  it('replays the subagent fixture end-to-end', () => {
    const parentLines = readFixture('fixtures/claude-code/subagent-parent.jsonl');
    const childLines = readFixture('fixtures/claude-code/subagent-child.jsonl');
    const meta = readMeta('fixtures/claude-code/subagent-child.meta.json');
    const subagents = [{
      agentId: 'test-agent-id',
      meta,
      lines: childLines,
    }];
    const { format, events } = adapt(parentLines, { subagents });
    expect(format).toBe('claude-code');
    const out = events.find(
      (e) => e.type === 'function_call_output' && e.callId === 'toolu_015x6sDGNVScP6yU4es5hysA'
    );
    expect(out).toBeTruthy();
    expect(out.output).toContain(meta.description);
    // The fixture's terminal assistant text was added in A5 to make this assertion meaningful —
    // verifies the formatSubagentSummary pipeline actually carries the subagent's final reply through.
    expect(out.output).toContain('调研完成');
  });
});
