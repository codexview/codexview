import { describe, it, expect } from 'vitest';
import { adaptAgentWebTranscript } from './agentweb-transcript.js';
import type {
  AgentWebMessage,
  AgentWebStreamingState,
} from './agentweb-transcript.js';

const NOW = 1_700_000_000_000;
const sessionId = 'sess-abc';

describe('adaptAgentWebTranscript — empty / minimal', () => {
  it('emits only thread_started and status=idle when given nothing', () => {
    const { events, status, error } = adaptAgentWebTranscript({ sessionId, now: NOW });
    expect(events).toEqual([{ type: 'thread_started', threadId: sessionId, at: NOW }]);
    expect(status).toBe('idle');
    expect(error).toBeUndefined();
  });
});

describe('adaptAgentWebTranscript — persisted history', () => {
  const messages: AgentWebMessage[] = [
    { id: 'u1', turnId: 't1', role: 'user', text: 'hi', at: NOW + 1 },
    { id: 'a1', turnId: 't1', role: 'assistant', text: 'hello', usage: { input: 10, cachedInput: 4, output: 6 }, at: NOW + 2 },
  ];

  it('synthesizes turn_started / turn_completed around a two-message turn', () => {
    const { events, status } = adaptAgentWebTranscript({ sessionId, messages, now: NOW });
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'thread_started',
      'turn_started',
      'user_message',
      'agent_message',
      'turn_completed',
    ]);
    const turn = events.find((e) => e.type === 'turn_completed') as any;
    expect(turn.turnId).toBe('t1');
    expect(turn.usage).toEqual({ inputTokens: 10, outputTokens: 6, cachedInputTokens: 4 });
    expect(status).toBe('completed');
  });

  it('preserves turnId so all rows of one exchange share a turn', () => {
    const { events } = adaptAgentWebTranscript({ sessionId, messages, now: NOW });
    const turnIds = events.filter((e) => 'turnId' in e).map((e: any) => e.turnId);
    expect(new Set(turnIds)).toEqual(new Set(['t1']));
  });

  it('emits user_message and agent_message with partial=false', () => {
    const { events } = adaptAgentWebTranscript({ sessionId, messages, now: NOW });
    const user = events.find((e) => e.type === 'user_message') as any;
    const agent = events.find((e) => e.type === 'agent_message') as any;
    expect(user.text).toBe('hi');
    expect(user.itemId).toBe('u1');
    expect(agent.text).toBe('hello');
    expect(agent.partial).toBe(false);
  });

  it('handles multi-turn history in order', () => {
    const multi: AgentWebMessage[] = [
      { id: 'u1', turnId: 't1', role: 'user', text: 'q1', at: NOW + 1 },
      { id: 'a1', turnId: 't1', role: 'assistant', text: 'a1', at: NOW + 2 },
      { id: 'u2', turnId: 't2', role: 'user', text: 'q2', at: NOW + 3 },
      { id: 'a2', turnId: 't2', role: 'assistant', text: 'a2', at: NOW + 4 },
    ];
    const { events } = adaptAgentWebTranscript({ sessionId, messages: multi, now: NOW });
    const turns = events.filter((e) => e.type === 'turn_started').map((e: any) => e.turnId);
    expect(turns).toEqual(['t1', 't2']);
  });
});

describe('adaptAgentWebTranscript — tool calls in persisted history', () => {
  it('maps run_command → exec_command_begin + exec_command_end', () => {
    const messages: AgentWebMessage[] = [
      { id: 'u1', turnId: 't1', role: 'user', text: 'list files', at: NOW + 1 },
      {
        id: 'a1',
        turnId: 't1',
        role: 'assistant',
        text: 'sure',
        toolCalls: [
          {
            callId: 'c1',
            name: 'run_command',
            args: { command: 'ls -la' },
            stdout: 'file1\nfile2',
            exit: 0,
            durationMs: 12,
            completed: true,
          },
        ],
        at: NOW + 2,
      },
    ];
    const { events } = adaptAgentWebTranscript({ sessionId, messages, now: NOW });
    const begin = events.find((e) => e.type === 'exec_command_begin') as any;
    const end = events.find((e) => e.type === 'exec_command_end') as any;
    expect(begin).toBeDefined();
    expect(begin.command).toBe('ls -la');
    expect(begin.callId).toBe('c1');
    expect(end.exit).toBe(0);
    expect(end.stdout).toBe('file1\nfile2');
    expect(end.durationMs).toBe(12);
  });

  it('maps non-shell tool calls → function_call + function_call_output', () => {
    const messages: AgentWebMessage[] = [
      {
        id: 'a1',
        turnId: 't1',
        role: 'assistant',
        toolCalls: [
          {
            callId: 'c1',
            name: 'search_web',
            args: { q: 'codexview' },
            output: { results: [] },
            completed: true,
          },
        ],
        at: NOW + 1,
      },
    ];
    const { events } = adaptAgentWebTranscript({ sessionId, messages, now: NOW });
    const call = events.find((e) => e.type === 'function_call') as any;
    const out = events.find((e) => e.type === 'function_call_output') as any;
    expect(call.name).toBe('search_web');
    expect(call.args).toEqual({ q: 'codexview' });
    expect(out.output).toEqual({ results: [] });
  });

  it('marks failed tool calls via error output', () => {
    const messages: AgentWebMessage[] = [
      {
        id: 'a1',
        turnId: 't1',
        role: 'assistant',
        toolCalls: [
          { callId: 'c1', name: 'fetch_url', args: { url: 'x' }, error: 'timeout', completed: true },
        ],
        at: NOW + 1,
      },
    ];
    const { events } = adaptAgentWebTranscript({ sessionId, messages, now: NOW });
    const out = events.find((e) => e.type === 'function_call_output') as any;
    expect(out.error).toBe('timeout');
  });
});

describe('adaptAgentWebTranscript — live streaming', () => {
  it('emits partial assistant text with partial=true and leaves turn open while streaming', () => {
    const streaming: AgentWebStreamingState = {
      turnId: 't1',
      partialText: 'partial...',
      status: 'streaming',
      at: NOW + 5,
    };
    const messages: AgentWebMessage[] = [
      { id: 'u1', turnId: 't1', role: 'user', text: 'hi', at: NOW + 1 },
    ];
    const { events, status } = adaptAgentWebTranscript({
      sessionId,
      messages,
      streaming,
      now: NOW,
    });
    const partial = events.find((e) => e.type === 'agent_message' && (e as any).partial === true) as any;
    expect(partial).toBeDefined();
    expect(partial.text).toBe('partial...');
    expect(partial.itemId).toBe('t1-live');
    expect(events.find((e) => e.type === 'turn_completed')).toBeUndefined();
    expect(status).toBe('working');
  });

  it('honors custom partialItemId for stable React keys across renders', () => {
    const streaming: AgentWebStreamingState = {
      turnId: 't1',
      partialText: 'p',
      partialItemId: 'live-key-42',
      status: 'streaming',
    };
    const { events } = adaptAgentWebTranscript({ sessionId, streaming, now: NOW });
    const partial = events.find((e) => e.type === 'agent_message') as any;
    expect(partial.itemId).toBe('live-key-42');
  });

  it('starts a brand-new turn when streaming.turnId is not in persisted history', () => {
    const streaming: AgentWebStreamingState = {
      turnId: 't-new',
      partialText: 'fresh',
      status: 'streaming',
      at: NOW + 10,
    };
    const { events } = adaptAgentWebTranscript({ sessionId, streaming, now: NOW });
    const types = events.map((e) => e.type);
    expect(types).toEqual(['thread_started', 'turn_started', 'agent_message']);
    expect((events[1] as any).turnId).toBe('t-new');
  });

  it('emits in-flight tool calls without their _end / _output counterparts', () => {
    const streaming: AgentWebStreamingState = {
      turnId: 't1',
      toolCalls: [
        { callId: 'c1', name: 'run_command', args: { command: 'sleep 5' }, completed: false },
      ],
      status: 'streaming',
      at: NOW + 1,
    };
    const { events } = adaptAgentWebTranscript({ sessionId, streaming, now: NOW });
    expect(events.find((e) => e.type === 'exec_command_begin')).toBeDefined();
    expect(events.find((e) => e.type === 'exec_command_end')).toBeUndefined();
  });
});

describe('adaptAgentWebTranscript — stream terminal states', () => {
  it('emits turn_failed and status=failed for failed streams', () => {
    const streaming: AgentWebStreamingState = {
      turnId: 't1',
      status: 'failed',
      error: 'rate limited',
      at: NOW + 9,
    };
    const { events, status, error } = adaptAgentWebTranscript({ sessionId, streaming, now: NOW });
    const failed = events.find((e) => e.type === 'turn_failed') as any;
    expect(failed.error.message).toBe('rate limited');
    expect(status).toBe('failed');
    expect(error).toEqual({ message: 'rate limited' });
  });

  it('emits turn_aborted and status=stopped for disconnected streams', () => {
    const streaming: AgentWebStreamingState = {
      turnId: 't1',
      status: 'disconnected',
      at: NOW + 9,
    };
    const { events, status } = adaptAgentWebTranscript({ sessionId, streaming, now: NOW });
    const aborted = events.find((e) => e.type === 'turn_aborted') as any;
    expect(aborted).toBeDefined();
    expect(aborted.reason).toBe('disconnected');
    expect(status).toBe('stopped');
  });

  it('emits turn_aborted and status=stopped for gaveUp streams', () => {
    const streaming: AgentWebStreamingState = {
      turnId: 't1',
      status: 'gaveUp',
      error: 'too many retries',
    };
    const { events, status, error } = adaptAgentWebTranscript({ sessionId, streaming, now: NOW });
    const aborted = events.find((e) => e.type === 'turn_aborted') as any;
    expect(aborted.reason).toBe('too many retries');
    expect(status).toBe('stopped');
    expect(error).toEqual({ message: 'too many retries' });
  });

  it('emits turn_completed with usage when stream finishes mid-state', () => {
    const streaming: AgentWebStreamingState = {
      turnId: 't1',
      status: 'completed',
      usage: { input: 5, output: 7 },
      at: NOW + 9,
    };
    const messages: AgentWebMessage[] = [
      { id: 'u1', turnId: 't1', role: 'user', text: 'hi', at: NOW + 1 },
    ];
    const { events, status } = adaptAgentWebTranscript({ sessionId, messages, streaming, now: NOW });
    const completed = events.filter((e) => e.type === 'turn_completed');
    expect(completed).toHaveLength(1);
    expect((completed[0] as any).usage).toEqual({ inputTokens: 5, outputTokens: 7 });
    expect(status).toBe('completed');
  });
});

describe('adaptAgentWebTranscript — token usage mapping', () => {
  it('maps AgentWeb { input, cachedInput, output } → CodexView TokenUsage', () => {
    const messages: AgentWebMessage[] = [
      { id: 'u1', turnId: 't1', role: 'user', text: 'hi' },
      { id: 'a1', turnId: 't1', role: 'assistant', text: 'hi', usage: { input: 100, cachedInput: 80, output: 20 } },
    ];
    const { events } = adaptAgentWebTranscript({ sessionId, messages, now: NOW });
    const completed = events.find((e) => e.type === 'turn_completed') as any;
    expect(completed.usage).toEqual({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 80 });
  });

  it('aggregates usage across multiple assistant rows in one turn', () => {
    const messages: AgentWebMessage[] = [
      { id: 'a1', turnId: 't1', role: 'assistant', text: 'one', usage: { input: 10, output: 5 } },
      { id: 'a2', turnId: 't1', role: 'assistant', text: 'two', usage: { input: 4, output: 3 } },
    ];
    const { events } = adaptAgentWebTranscript({ sessionId, messages, now: NOW });
    const completed = events.find((e) => e.type === 'turn_completed') as any;
    expect(completed.usage).toEqual({ inputTokens: 14, outputTokens: 8 });
  });
});
