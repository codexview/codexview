import { describe, expect, it } from 'vitest';
import { adaptAppServerThread, AppServerTranscriptStore, type AppServerThread } from './app-server.js';

const params = (itemId = 'message', turnId = 'turn') => ({ threadId: 'thread', turnId, itemId });
const history = (status = 'completed', text = 'history'): AppServerThread => ({
  id: 'thread', createdAt: 1,
  turns: [{ id: 'turn', status, startedAt: 2, completedAt: 3, items: [{ id: 'message', type: 'agentMessage', text }] }],
});

describe('app-server transcript', () => {
  it('accumulates deltas and replaces them with authoritative completion exactly once', () => {
    const store = new AppServerTranscriptStore('thread');
    store.apply('item/agentMessage/delta', { ...params(), delta: 'hel' });
    store.apply('item/agentMessage/delta', { ...params(), delta: 'lo' });
    expect(store.getEvents().filter(e => e.type === 'agent_message')).toEqual([
      { type: 'agent_message', turnId: 'turn', itemId: 'message', text: 'hello', partial: true, at: 0 },
    ]);
    store.apply('item/completed', { ...params(), item: { id: 'message', type: 'agentMessage', text: 'Hello!', phase: 'final_answer' } });
    expect(store.apply('item/agentMessage/delta', { ...params(), delta: 'replay' })).toBe(false);
    expect(store.apply('item/completed', { ...params(), item: { id: 'message', type: 'agentMessage', text: 'replay' } })).toBe(false);
    expect(store.getEvents().filter(e => e.type === 'agent_message')).toEqual([
      { type: 'agent_message', turnId: 'turn', itemId: 'message', text: 'Hello!', partial: false, phase: 'final_answer', at: 0 },
    ]);
  });

  it('keeps live items and terminal status when stale history arrives', () => {
    const store = new AppServerTranscriptStore('thread');
    store.apply('turn/started', { threadId: 'thread', turn: { id: 'turn', status: 'inProgress' } });
    store.apply('item/agentMessage/delta', { ...params(), delta: 'live' });
    store.mergeHistory(history('inProgress', 'stale'));
    store.apply('item/agentMessage/delta', { ...params(), delta: ' text' });
    expect(store.getEvents().find(e => e.type === 'agent_message')).toMatchObject({ text: 'live text', partial: true });
    store.apply('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'failed', error: { message: 'broken' } } });
    store.mergeHistory(history('completed'));
    expect(store.getEvents().at(-1)).toMatchObject({ type: 'turn_failed', error: { message: 'broken' } });
  });

  it('reconciles prior-process live state with terminal durable history in a new epoch', () => {
    const store = new AppServerTranscriptStore('thread');
    store.apply('turn/started', { threadId: 'thread', turn: { id: 'turn', status: 'inProgress' } });
    store.apply('item/agentMessage/delta', { ...params(), delta: 'partial before loss' });
    const visible = store.getEvents();
    store.beginEpoch();
    expect(store.getEvents()).toBe(visible);
    store.mergeHistory(history('completed', 'persisted final'));
    expect(store.getEvents().find(e => e.type === 'agent_message')).toMatchObject({ text: 'persisted final', partial: false });
    expect(store.getEvents().at(-1)).toMatchObject({ type: 'turn_completed' });
    expect(store.apply('turn/started', { threadId: 'thread', turn: { id: 'turn', status: 'inProgress' } })).toBe(false);
    expect(store.getEvents().at(-1)).toMatchObject({ type: 'turn_completed' });
  });

  it('hydrates history, deduplicates subsequent finals, and routes strictly by thread', () => {
    const store = new AppServerTranscriptStore('thread');
    store.mergeHistory(history());
    expect(store.apply('item/completed', { ...params(), item: { id: 'message', type: 'agentMessage', text: 'history' } })).toBe(true);
    expect(store.apply('item/agentMessage/delta', { ...params(), threadId: 'other', delta: 'foreign' })).toBe(false);
    expect(store.apply('item/agentMessage/delta', { turnId: 'turn', itemId: 'missing', delta: 'foreign' })).toBe(false);
    store.mergeHistory({ ...history(), id: 'other' });
    expect(store.getEvents().filter(e => e.type === 'agent_message')).toHaveLength(1);
    expect(adaptAppServerThread(history())).toEqual(store.getEvents());
    expect(store.getEvents()[1]).toMatchObject({ at: 2000 });
  });

  it('preserves prior event references and memoizes unchanged snapshots', () => {
    const store = new AppServerTranscriptStore('thread');
    store.apply('item/completed', { ...params('prior'), item: { id: 'prior', type: 'agentMessage', text: 'done' } });
    const first = store.getEvents();
    expect(store.getEvents()).toBe(first);
    store.apply('item/agentMessage/delta', { ...params('next'), delta: 'new' });
    const next = store.getEvents();
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next[2]).toBe(first[2]);
    store.mergeHistory(history());
    store.apply('item/completed', { ...params(), item: { id: 'message', type: 'agentMessage', text: 'authoritative live' } });
    expect(store.getEvents().find(e => e.type === 'agent_message' && e.itemId === 'message')).toMatchObject({ text: 'authoritative live' });
  });

  it('keeps identically named items independent across turns', () => {
    const store = new AppServerTranscriptStore('thread');
    for (const id of ['one', 'two']) store.apply('item/agentMessage/delta', { ...params('same', id), delta: id });
    expect(store.getEvents().filter(e => e.type === 'agent_message').map(e => e.text)).toEqual(['one', 'two']);
  });

  it('accumulates reasoning by content index and renders command output through final', () => {
    const store = new AppServerTranscriptStore('thread');
    store.apply('item/reasoning/summaryTextDelta', { ...params('reasoning'), delta: 'Summary', summaryIndex: 0 });
    store.apply('item/reasoning/textDelta', { ...params('reasoning'), delta: 'second', contentIndex: 1 });
    store.apply('item/reasoning/textDelta', { ...params('reasoning'), delta: 'first', contentIndex: 0 });
    expect(store.getEvents().find(e => e.type === 'reasoning')).toMatchObject({ text: 'Summary\n\nfirst\n\nsecond' });
    store.apply('item/started', { ...params('command'), item: { id: 'command', type: 'commandExecution', command: 'pwd', status: 'inProgress' } });
    store.apply('item/commandExecution/outputDelta', { ...params('command'), delta: '/tmp' });
    expect(store.getEvents().find(e => e.type === 'raw')).toMatchObject({ payload: { aggregatedOutput: '/tmp' } });
    store.apply('item/completed', { ...params('command'), item: { id: 'command', type: 'commandExecution', command: 'pwd', aggregatedOutput: '/final', exitCode: 2, durationMs: 15 } });
    expect(store.getEvents().filter(e => e.type === 'exec_command_begin')).toHaveLength(1);
    expect(store.getEvents().find(e => e.type === 'exec_command_end')).toMatchObject({ stdout: '/final', exit: 2, durationMs: 15 });
  });

  it('maps tools, failed/interrupted turns and compaction visibly', () => {
    const thread: AppServerThread = { id: 'thread', turns: [
      { id: 'failed', status: 'failed', error: { message: 'denied' }, items: [
        { id: 'mcp', type: 'mcpToolCall', server: 'test', tool: 'lookup', arguments: { q: 'a' }, error: { message: 'tool failure' } },
        { id: 'patch', type: 'fileChange', status: 'completed', changes: [{ path: 'file', kind: { type: 'add' }, diff: '+new' }] },
        { id: 'compact', type: 'contextCompaction' },
      ] },
      { id: 'interrupted', status: 'interrupted', error: { message: 'cancelled' }, items: [] },
    ] };
    const events = adaptAppServerThread(thread);
    expect(events.find(e => e.type === 'mcp_tool_call_output')).toMatchObject({ error: 'tool failure' });
    expect(events.find(e => e.type === 'patch_apply_end')).toMatchObject({ ok: true, files: [{ path: 'file', status: 'added', diff: '+new' }] });
    expect(events.find(e => e.type === 'raw')).toMatchObject({ payload: { type: 'contextCompaction' } });
    expect(events.find(e => e.type === 'turn_failed')).toMatchObject({ error: { message: 'denied' } });
    expect(events.at(-1)).toMatchObject({ type: 'turn_aborted', reason: 'cancelled' });
    const store = new AppServerTranscriptStore('thread');
    expect(store.apply('thread/compacted', params())).toBe(true);
    expect(store.apply('thread/compacted', params())).toBe(false);
    expect(store.getEvents().at(-1)).toMatchObject({ type: 'raw', payload: { type: 'contextCompaction' } });
  });

  it('prunes completed turns while retaining active turns and exposing truncation', () => {
    const store = new AppServerTranscriptStore('thread', { maxTurns: 1 });
    store.apply('item/agentMessage/delta', { ...params('active', 'active'), delta: 'working' });
    for (const id of ['old', 'new']) store.apply('turn/completed', { threadId: 'thread', turn: { id, status: 'completed' } });
    expect(store.truncated).toBe(true);
    expect(store.getEvents().filter(e => e.type === 'turn_started').map(e => e.turnId)).toEqual(['active', 'new']);
    const zero = new AppServerTranscriptStore('thread', { maxTurns: 0 });
    zero.mergeHistory(history());
    expect(zero.getEvents()).toHaveLength(1);
    expect(zero.truncated).toBe(true);
  });
});

it('preserves real declined commands and pending file changes without inventing exit zero', () => {
  const store = new AppServerTranscriptStore('thread');
  store.apply('item/completed', { ...params('command'), item: { type: 'commandExecution', id: 'command', command: 'printf COMMAND_DECLINE', status: 'declined', exitCode: null, durationMs: null, aggregatedOutput: null } });
  expect(store.getEvents().find(e => e.type === 'exec_command_end')).toMatchObject({ exit: null, outcome: 'declined' });
  const item = { type: 'fileChange', id: 'patch', status: 'inProgress', changes: [{ path: 'accept.txt', kind: { type: 'add' }, diff: 'FILE_ACCEPT\n' }] };
  store.apply('item/started', { ...params('patch'), item });
  expect(store.getEvents().find(e => e.type === 'patch_apply_begin')).toMatchObject({ callId: 'patch', files: [{ path: 'accept.txt', status: 'added', diff: 'FILE_ACCEPT\n' }] });
  store.apply('item/completed', { ...params('patch'), item: { ...item, status: 'declined' } });
  expect(store.getEvents().some(e => e.type === 'patch_apply_begin')).toBe(false);
  expect(store.getEvents().find(e => e.type === 'patch_apply_end')).toMatchObject({ ok: false, outcome: 'declined' });
});
