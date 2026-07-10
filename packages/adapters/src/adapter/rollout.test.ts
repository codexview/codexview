import { describe, it, expect } from 'vitest';
import { adaptRollout } from './rollout.js';
import type { RawLine } from '../types.js';

describe('adaptRollout', () => {
  it('opens a thread on session_meta', () => {
    const out = adaptRollout([
      { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id: 'T1' } },
    ] as RawLine[]);
    expect(out[0]).toMatchObject({ type: 'thread_started', threadId: 'T1' });
  });

  it('synthesises a turn for orphan response_items', () => {
    const out = adaptRollout([
      { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id: 'T1' } },
      { type: 'response_item', timestamp: '2026-01-01T00:00:01Z',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } },
    ] as RawLine[]);
    expect(out.some((e) => e.type === 'turn_started')).toBe(true);
    expect(out.some((e) => e.type === 'user_message' && e.text === 'hi')).toBe(true);
  });

  it('emits exec_command_begin + _end for exec_command_end event_msg', () => {
    const out = adaptRollout([
      { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id: 'T' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:01Z',
        payload: { type: 'task_started', turn_id: 'turn1' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:02Z',
        payload: { type: 'exec_command_end', call_id: 'c1', command: ['ls'], exit_code: 0, stdout: '', stderr: '', duration_ms: 5 } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:03Z',
        payload: { type: 'task_complete' } },
    ] as RawLine[]);
    const types = out.map((e) => e.type);
    expect(types).toContain('exec_command_begin');
    expect(types).toContain('exec_command_end');
    expect(types).toContain('turn_completed');
  });

  it('emits agent_message + turn_completed for full task lifecycle', () => {
    const out = adaptRollout([
      { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id: 'T' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:01Z',
        payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:02Z',
        payload: { type: 'agent_message', message: 'hi' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:03Z',
        payload: { type: 'task_complete' } },
    ] as RawLine[]);
    expect(out.some((e) => e.type === 'agent_message' && e.text === 'hi')).toBe(true);
    expect(out[out.length - 1].type).toBe('turn_completed');
  });

  it('can leave an unfinished task open for live tailing', () => {
    const out = adaptRollout([
      { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id: 'T' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:01Z',
        payload: { type: 'task_started', turn_id: 't-live' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:02Z',
        payload: { type: 'agent_message', message: 'still working' } },
    ] as RawLine[], { closeOpenTurn: false });
    expect(out.some((e) => e.type === 'turn_completed')).toBe(false);
    expect(out[out.length - 1]).toMatchObject({ type: 'agent_message', text: 'still working' });
  });

  it('dedupes agent_message from event_msg + response_item', () => {
    const out = adaptRollout([
      { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id: 'T' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:01Z',
        payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:02Z',
        payload: { type: 'agent_message', message: 'hello' } },
      { type: 'response_item', timestamp: '2026-01-01T00:00:03Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:04Z',
        payload: { type: 'task_complete' } },
    ] as RawLine[]);
    const agentMessages = out.filter((e) => e.type === 'agent_message');
    expect(agentMessages.length).toBe(1);
  });

  it('uses canonical item turn/timestamps and preserves message phase', () => {
    const out = adaptRollout([
      { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id: 'T' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:01Z',
        payload: { type: 'task_started', turn_id: 'stale-turn' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:01Z', payload: {
        type: 'item_completed', turn_id: 'canonical-turn', completed_at_ms: 1233,
        item: { type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'question' }] },
      } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:02Z', payload: {
        type: 'item_completed', turn_id: 'canonical-turn', completed_at_ms: 1234,
        item: { type: 'AgentMessage', id: 'a1', content: [{ type: 'Text', text: 'same' }], phase: 'commentary' },
      } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:03Z', payload: {
        type: 'item_completed', turn_id: 'canonical-turn', completed_at_ms: 1235,
        item: { type: 'AgentMessage', id: 'a2', content: [{ type: 'Text', text: 'same' }], phase: 'final_answer' },
      } },
      { type: 'response_item', timestamp: '2026-01-01T00:00:04Z',
        payload: { type: 'message', id: 'a2', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'same' }] } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:05Z', payload: {
        type: 'item_completed', turn_id: 'canonical-turn', completed_at_ms: 1236,
        item: { type: 'Reasoning', id: 'r1', summary_text: ['checked'], raw_content: [] },
      } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:06Z',
        payload: { type: 'agent_message', id: 'legacy-a1', message: 'legacy phase', phase: 'commentary' } },
      { type: 'event_msg', timestamp: '2026-01-01T00:00:06Z', payload: { type: 'task_complete' } },
    ] as RawLine[]);

    const messages = out.filter((e) => e.type === 'agent_message');
    expect(messages).toHaveLength(3);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'a1', turnId: 'canonical-turn', phase: 'commentary', at: 1234 }),
      expect.objectContaining({ itemId: 'a2', turnId: 'canonical-turn', phase: 'final_answer', at: 1235 }),
      expect.objectContaining({ itemId: 'legacy-a1', turnId: 'canonical-turn', phase: 'commentary' }),
    ]));
    expect(out).toContainEqual(expect.objectContaining({
      type: 'reasoning', itemId: 'r1', turnId: 'canonical-turn', text: 'checked', at: 1236,
    }));
    expect(out).toContainEqual(expect.objectContaining({
      type: 'user_message', itemId: 'u1', turnId: 'canonical-turn', text: 'question', at: 1233,
    }));
  });

  it('adapts canonical tool items, including completions without starts, without legacy duplicates', () => {
    const out = adaptRollout([
      { type: 'session_meta', timestamp: 1, payload: { id: 'T' } },
      { type: 'event_msg', timestamp: 2, payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'event_msg', timestamp: 3, payload: {
        type: 'item_completed', turn_id: 't1', completed_at_ms: 30,
        item: { type: 'CommandExecution', id: 'cmd1', command: ['echo', 'ok'], status: 'completed', stdout: 'ok\n', stderr: '', exit_code: 0, duration: { secs: 0, nanos: 5_000_000 } },
      } },
      { type: 'event_msg', timestamp: 31, payload: { type: 'exec_command_end', call_id: 'cmd1', command: ['echo', 'ok'], exit_code: 0, stdout: 'ok\n', stderr: '' } },
      { type: 'event_msg', timestamp: 32, payload: {
        type: 'item_completed', turn_id: 't1', completed_at_ms: 32,
        item: { type: 'CommandExecution', id: 'cmd2', command: ['rm', 'file'], status: 'declined' },
      } },
      { type: 'event_msg', timestamp: 4, payload: {
        type: 'item_started', turn_id: 't1', started_at_ms: 40,
        item: { type: 'DynamicToolCall', id: 'dyn1', tool: 'lookup', arguments: { id: 1 }, status: 'in_progress' },
      } },
      { type: 'event_msg', timestamp: 5, payload: {
        type: 'item_completed', turn_id: 't1', completed_at_ms: 50,
        item: { type: 'DynamicToolCall', id: 'dyn1', tool: 'lookup', arguments: { id: 1 }, status: 'completed', success: true, content_items: [{ type: 'inputText', text: 'found' }] },
      } },
      { type: 'event_msg', timestamp: 6, payload: {
        type: 'item_completed', turn_id: 't1', completed_at_ms: 60,
        item: { type: 'McpToolCall', id: 'mcp1', server: 'calendar', tool: 'list', arguments: {}, status: 'completed', result: { content: [{ type: 'text', text: 'ok' }] } },
      } },
      { type: 'event_msg', timestamp: 7, payload: {
        type: 'item_completed', turn_id: 't1', completed_at_ms: 70,
        item: { type: 'FileChange', id: 'patch1', status: 'completed', changes: {
          'a.ts': { type: 'update', unified_diff: '@@ -1 +1 @@' },
          'b.ts': { type: 'add', content: 'new' },
        } },
      } },
      { type: 'event_msg', timestamp: 8, payload: {
        type: 'item_completed', turn_id: 't1', completed_at_ms: 80,
        item: { type: 'WebSearch', id: 'web1', query: 'codex docs', action: { type: 'search' } },
      } },
      { type: 'event_msg', timestamp: 9, payload: {
        type: 'item_completed', turn_id: 't1', completed_at_ms: 90,
        item: { type: 'WebSearch', id: 'web2', query: 'codex docs', action: { type: 'search' } },
      } },
      { type: 'event_msg', timestamp: 10, payload: { type: 'task_complete' } },
    ] as RawLine[]);

    expect(out.filter((e) => e.type === 'exec_command_begin' && e.callId === 'cmd1')).toHaveLength(1);
    expect(out.filter((e) => e.type === 'exec_command_end' && e.callId === 'cmd1')).toHaveLength(1);
    expect(out).toContainEqual(expect.objectContaining({
      type: 'exec_command_end', callId: 'cmd1', durationMs: 5, at: 30,
    }));
    expect(out).toContainEqual(expect.objectContaining({ type: 'exec_command_end', callId: 'cmd2', exit: 1 }));
    expect(out).toContainEqual(expect.objectContaining({ type: 'function_call', callId: 'dyn1', at: 40 }));
    expect(out).toContainEqual(expect.objectContaining({ type: 'function_call_output', callId: 'dyn1', output: 'found', at: 50 }));
    expect(out).toContainEqual(expect.objectContaining({ type: 'mcp_tool_call_output', callId: 'mcp1', at: 60 }));
    expect(out).toContainEqual(expect.objectContaining({
      type: 'patch_apply_end', callId: 'patch1', ok: true,
      files: [
        { path: 'a.ts', status: 'modified', diff: '@@ -1 +1 @@' },
        { path: 'b.ts', status: 'added' },
      ],
    }));
    expect(out.filter((e) => e.type === 'web_search_end')).toHaveLength(2);
  });

  it('covers canonical plan, todo and collaboration items', () => {
    const out = adaptRollout([
      { type: 'event_msg', timestamp: 1, payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'event_msg', timestamp: 2, payload: { type: 'item_completed', turn_id: 't1', item: { type: 'Plan', id: 'plan1', text: 'Do it carefully' } } },
      { type: 'event_msg', timestamp: 3, payload: { type: 'item_completed', turn_id: 't1', item: { type: 'TodoList', id: 'todo1', items: [{ text: 'First', completed: true }, { step: 'Second', status: 'pending' }] } } },
      { type: 'event_msg', timestamp: 4, payload: { type: 'item_started', turn_id: 't1', item: {
        type: 'CollabAgentToolCall', id: 'collab1', tool: 'spawn_agent', status: 'in_progress', sender_thread_id: 'root', receiver_thread_ids: ['child'], prompt: 'Review', agents_states: {},
      } } },
      { type: 'event_msg', timestamp: 5, payload: { type: 'item_completed', turn_id: 't1', item: {
        type: 'CollabAgentToolCall', id: 'collab1', tool: 'spawn_agent', status: 'completed', sender_thread_id: 'root', receiver_thread_ids: ['child'], agents_states: { child: 'completed' },
      } } },
      { type: 'event_msg', timestamp: 6, payload: { type: 'item_completed', turn_id: 't1', item: {
        type: 'SubAgentActivity', id: 'activity1', kind: 'started', agent_thread_id: 'child', agent_path: '/root/child',
      } } },
      { type: 'event_msg', timestamp: 7, payload: { type: 'task_complete' } },
    ] as RawLine[]);

    expect(out).toContainEqual(expect.objectContaining({ type: 'raw', itemId: 'plan1' }));
    expect(out).toContainEqual(expect.objectContaining({
      type: 'todo_list', itemId: 'todo1', items: [
        { text: 'First', completed: true },
        { text: 'Second', completed: false },
      ],
    }));
    expect(out).toContainEqual(expect.objectContaining({ type: 'function_call', callId: 'collab1', name: 'collab_agent_spawn_agent' }));
    expect(out).toContainEqual(expect.objectContaining({ type: 'function_call_output', callId: 'collab1' }));
    expect(out).toContainEqual(expect.objectContaining({ type: 'raw', itemId: 'activity1' }));
  });

  it('preserves full token usage across rate-limit-only updates and ignores rollout metadata', () => {
    const out = adaptRollout([
      { type: 'world_state', timestamp: 1, payload: { full: true, state: {} } },
      { type: 'inter_agent_communication_metadata', timestamp: 2, payload: { trigger_turn: false } },
      { type: 'event_msg', timestamp: 3, payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'event_msg', timestamp: 4, payload: { type: 'token_count', info: { last_token_usage: {
        input_tokens: 10, cached_input_tokens: 4, output_tokens: 8, reasoning_output_tokens: 3,
      } } } },
      { type: 'event_msg', timestamp: 5, payload: { type: 'token_count', info: null, rate_limits: { primary: { used_percent: 10 } } } },
      { type: 'event_msg', timestamp: 6, payload: { type: 'thread_settings_applied', thread_settings: {} } },
      { type: 'event_msg', timestamp: 7, payload: { type: 'thread_goal_updated', goal: {} } },
      { type: 'event_msg', timestamp: 8, payload: { type: 'task_complete' } },
    ] as RawLine[]);

    expect(out.some((e) => e.type === 'raw')).toBe(false);
    expect(out.at(-1)).toMatchObject({
      type: 'turn_completed',
      usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 8, reasoningOutputTokens: 3 },
    });
  });

  it('does not reopen a canonical turn when task_started for the same turn arrives later', () => {
    const out = adaptRollout([
      { type: 'event_msg', timestamp: 1, payload: {
        type: 'item_completed',
        turn_id: 't1',
        completed_at_ms: 10,
        item: { type: 'AgentMessage', id: 'a1', content: [{ type: 'Text', text: 'ready' }], phase: 'final_answer' },
      } },
      { type: 'event_msg', timestamp: 2, payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'event_msg', timestamp: 3, payload: { type: 'task_complete' } },
    ] as RawLine[]);

    expect(out.filter((event) => event.type === 'turn_started' && event.turnId === 't1')).toHaveLength(1);
    expect(out.filter((event) => event.type === 'agent_message')).toHaveLength(1);
  });

  it('preserves repeated same-source messages while removing cross-source mirrors', () => {
    const prefix = 'x'.repeat(220);
    const out = adaptRollout([
      { type: 'event_msg', timestamp: 1, payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'event_msg', timestamp: 2, payload: { type: 'agent_message', message: `${prefix}-one`, phase: 'commentary' } },
      { type: 'event_msg', timestamp: 3, payload: { type: 'agent_message', message: `${prefix}-two`, phase: 'commentary' } },
      { type: 'event_msg', timestamp: 4, payload: { type: 'agent_message', message: 'repeat', phase: 'commentary' } },
      { type: 'event_msg', timestamp: 5, payload: { type: 'agent_message', message: 'repeat', phase: 'commentary' } },
      { type: 'response_item', timestamp: 6, payload: {
        type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'repeat' }],
      } },
      { type: 'event_msg', timestamp: 7, payload: { type: 'task_complete' } },
    ] as RawLine[]);

    expect(out.filter((event) => event.type === 'agent_message')).toHaveLength(4);
  });
});
