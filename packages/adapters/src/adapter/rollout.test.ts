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
});
