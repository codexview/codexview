import { describe, expect, it } from 'vitest';
import type { RawLine } from '../types.js';
import { adaptCodexExec } from './codex-exec.js';

describe('adaptCodexExec', () => {
  it('uses deterministic line-index timestamps by default', () => {
    const events = adaptCodexExec([
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'turn.started' },
    ] as RawLine[]);

    expect(events.map((event) => event.at)).toEqual([0, 1]);
  });

  it('maps the official codex exec --json example lifecycle', () => {
    const events = adaptCodexExec([
      { type: 'thread.started', thread_id: '0199db40-a6f1-7583-ad9f-1e9b8883e033' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'We need answer.' } },
      { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Hello!' } },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 42,
          cached_input_tokens: 10,
          output_tokens: 7,
          reasoning_output_tokens: 3,
        },
      },
    ] as RawLine[], { startAt: 100 });

    expect(events).toEqual([
      { type: 'thread_started', threadId: '0199db40-a6f1-7583-ad9f-1e9b8883e033', at: 100 },
      { type: 'turn_started', turnId: '0199db40-a6f1-7583-ad9f-1e9b8883e033:turn:1', at: 101 },
      {
        type: 'reasoning', turnId: '0199db40-a6f1-7583-ad9f-1e9b8883e033:turn:1', itemId: 'item_0', text: 'We need answer.', partial: false, at: 102,
      },
      {
        type: 'agent_message', turnId: '0199db40-a6f1-7583-ad9f-1e9b8883e033:turn:1', itemId: 'item_1', text: 'Hello!', partial: false, at: 103,
      },
      {
        type: 'turn_completed',
        turnId: '0199db40-a6f1-7583-ad9f-1e9b8883e033:turn:1',
        at: 104,
        usage: {
          inputTokens: 42,
          cachedInputTokens: 10,
          outputTokens: 7,
          reasoningOutputTokens: 3,
        },
      },
    ]);
  });

  it('updates message items in place via stable ids and partial flags', () => {
    const events = adaptCodexExec([
      { type: 'turn.started' },
      { type: 'item.started', item: { id: 'message-1', type: 'agent_message', text: 'Hel' } },
      { type: 'item.updated', item: { id: 'message-1', type: 'agent_message', text: 'Hello' } },
      { type: 'item.completed', item: { id: 'message-1', type: 'agent_message', text: 'Hello!' } },
    ] as RawLine[], { startAt: 10 });

    expect(events.filter((event) => event.type === 'agent_message')).toEqual([
      {
        type: 'agent_message', turnId: 'turn-1', itemId: 'message-1', text: 'Hel', partial: true, at: 11,
      },
      {
        type: 'agent_message', turnId: 'turn-1', itemId: 'message-1', text: 'Hello', partial: true, at: 12,
      },
      {
        type: 'agent_message', turnId: 'turn-1', itemId: 'message-1', text: 'Hello!', partial: false, at: 13,
      },
    ]);
  });

  it('does not repeat command begin on updates and completes with aggregated output', () => {
    const events = adaptCodexExec([
      { type: 'turn.started' },
      {
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: 'pnpm test', aggregated_output: '', status: 'in_progress' },
      },
      {
        type: 'item.updated',
        item: { id: 'cmd-1', type: 'command_execution', command: 'pnpm test', aggregated_output: 'running', status: 'in_progress' },
      },
      {
        type: 'item.completed',
        item: { id: 'cmd-1', type: 'command_execution', command: 'pnpm test', aggregated_output: 'passed', exit_code: 0, status: 'completed' },
      },
    ] as RawLine[], { startAt: 20 });

    expect(events.filter((event) => event.type === 'exec_command_begin')).toEqual([
      { type: 'exec_command_begin', turnId: 'turn-1', callId: 'cmd-1', command: 'pnpm test', at: 21 },
    ]);
    expect(events.find((event) => event.type === 'exec_command_end')).toEqual({
      type: 'exec_command_end',
      turnId: 'turn-1',
      callId: 'cmd-1',
      exit: 0,
      stdout: 'passed',
      stderr: '',
      durationMs: 0,
      at: 23,
    });
  });

  it('synthesizes missing call begins for completed MCP, collab, and web-search items', () => {
    const events = adaptCodexExec([
      { type: 'turn.started' },
      {
        type: 'item.completed',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'docs',
          tool: 'search',
          arguments: { q: 'Codex' },
          result: { content: [{ type: 'text', text: 'Found' }], structured_content: null },
          error: null,
          status: 'completed',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'collab-1',
          type: 'collab_tool_call',
          tool: 'spawn_agent',
          sender_thread_id: 'sender',
          receiver_thread_ids: ['receiver'],
          prompt: 'Implement it',
          agents_states: { receiver: { status: 'completed', message: 'done' } },
          status: 'completed',
        },
      },
      {
        type: 'item.completed',
        item: { id: 'search-1', type: 'web_search', query: 'Codex JSONL', action: { type: 'search' } },
      },
    ] as RawLine[], { startAt: 30 });

    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'mcp_tool_call',
      'mcp_tool_call_output',
      'function_call',
      'function_call_output',
      'web_search_call',
      'web_search_end',
    ]);
    expect(events.filter((event) =>
      event.type === 'mcp_tool_call'
      || event.type === 'function_call'
      || event.type === 'web_search_call')).toEqual([
      {
        type: 'mcp_tool_call', turnId: 'turn-1', callId: 'mcp-1', server: 'docs', name: 'search', args: { q: 'Codex' }, at: 31,
      },
      {
        type: 'function_call',
        turnId: 'turn-1',
        callId: 'collab-1',
        name: 'collab.spawn_agent',
        args: { senderThreadId: 'sender', receiverThreadIds: ['receiver'], prompt: 'Implement it' },
        at: 32,
      },
      {
        type: 'web_search_call', turnId: 'turn-1', callId: 'search-1', query: 'Codex JSONL', at: 33,
      },
    ]);
  });

  it('maps file changes, todo updates, item errors, and fatal stream errors', () => {
    const events = adaptCodexExec([
      { type: 'turn.started' },
      {
        type: 'item.completed',
        item: {
          id: 'patch-1',
          type: 'file_change',
          changes: [
            { path: 'new.ts', kind: 'add' },
            { path: 'old.ts', kind: 'delete' },
            { path: 'same.ts', kind: 'update' },
          ],
          status: 'completed',
        },
      },
      {
        type: 'item.updated',
        item: { id: 'todo-1', type: 'todo_list', items: [{ text: 'Test it', completed: true }] },
      },
      { type: 'item.completed', item: { id: 'warning-1', type: 'error', message: 'Warning' } },
      { type: 'error', message: 'Fatal detail' },
    ] as RawLine[], { startAt: 40 });

    expect(events.find((event) => event.type === 'patch_apply_end')).toEqual({
      type: 'patch_apply_end',
      turnId: 'turn-1',
      callId: 'patch-1',
      files: [
        { path: 'new.ts', status: 'added' },
        { path: 'old.ts', status: 'deleted' },
        { path: 'same.ts', status: 'modified' },
      ],
      ok: true,
      at: 41,
    });
    expect(events.find((event) => event.type === 'todo_list')).toMatchObject({
      itemId: 'todo-1', items: [{ text: 'Test it', completed: true }], at: 42,
    });
    expect(events.filter((event) => event.type === 'error_item')).toEqual([
      { type: 'error_item', turnId: 'turn-1', itemId: 'warning-1', message: 'Warning', at: 43 },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'turn_failed', turnId: 'turn-1', error: { message: 'Fatal detail' }, at: 44,
    });
  });

  it('maps an explicit turn.failed event', () => {
    const events = adaptCodexExec([
      { type: 'turn.started' },
      { type: 'turn.failed', error: { message: 'Turn stopped' } },
    ] as RawLine[], { startAt: 45 });

    expect(events.at(-1)).toEqual({
      type: 'turn_failed', turnId: 'turn-1', error: { message: 'Turn stopped' }, at: 46,
    });
  });

  it('does not synthesize a second failed turn when error is followed by turn.failed', () => {
    const events = adaptCodexExec([
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'turn.started' },
      { type: 'error', message: 'stream failed' },
      { type: 'turn.failed', error: { message: 'stream failed' } },
    ] as RawLine[]);

    expect(events.filter((event) => event.type === 'turn_started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn_failed')).toEqual([
      {
        type: 'turn_failed',
        turnId: 'thread-1:turn:1',
        at: 2,
        error: { message: 'stream failed' },
      },
    ]);
  });

  it('preserves unknown item types as raw events', () => {
    const line = { type: 'item.completed', item: { id: 'future-1', type: 'future_item', value: 1 } };
    const events = adaptCodexExec([
      { type: 'turn.started' },
      line,
    ] as RawLine[], { startAt: 50 });

    expect(events.at(-1)).toEqual({
      type: 'raw', turnId: 'turn-1', itemId: 'future-1', payload: line, at: 51,
    });
  });
});
