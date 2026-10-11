import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { CodexRuntime, UncertainOutcomeError } from '../src/index.js';
import type { RuntimeProcess } from '../src/types.js';

class FakeProcess extends EventEmitter implements RuntimeProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  messages: any[] = [];
  handler: (message: any) => void = message => {
    if (message.id !== undefined) this.response(message.id, {});
  };
  stdin = new Writable({ write: (chunk, _encoding, callback) => {
    const message = JSON.parse(String(chunk)); this.messages.push(message); this.handler(message); callback();
  } });
  response(id: string | number, result: unknown) { this.emitMessage({ id, result }); }
  emitMessage(message: unknown) { this.stdout.write(JSON.stringify(message) + '\n'); }
  kill() { this.emit('exit', 0); return true; }
}
const thread = (id = 't', turns: unknown[] = []) => ({ id, turns });
async function setup() {
  const process = new FakeProcess();
  process.handler = message => {
    if (message.id === undefined) return;
    if (message.method === 'thread/start' || message.method === 'thread/resume' || message.method === 'thread/read') process.response(message.id, { thread: thread() });
    else if (message.method === 'thread/turns/list') process.response(message.id, { data: [], nextCursor: null });
    else if (message.method === 'turn/start') process.response(message.id, { turn: { id: 'turn', status: 'inProgress', items: [] } });
    else process.response(message.id, {});
  };
  const runtime = new CodexRuntime({ spawn: () => process, snapshotIntervalMs: 1, requestTimeoutMs: 30 });
  await runtime.start();
  return { runtime, process };
}

describe('CodexRuntime protocol', () => {
  it('initializes once with stable capabilities before requests', async () => {
    const { runtime, process } = await setup();
    await runtime.start(); await runtime.createThread();
    expect(process.messages.map(m => m.method)).toEqual(['initialize', 'initialized', 'thread/start']);
    expect(process.messages[0].params.capabilities).toBeNull();
    await runtime.close();
  });
  it('requires explicit experimental opt-in for collaboration mode and preserves plan settings', async () => {
    const mode = { mode: 'plan' as const, settings: { model: 'test-model', reasoning_effort: 'medium', developer_instructions: null } };
    const stable = await setup();
    await stable.runtime.createThread();
    await expect(stable.runtime.send('t', 'question', { collaborationMode: mode })).rejects.toThrow('experimentalApi');
    expect(stable.process.messages.some(m => m.method === 'turn/start')).toBe(false);
    await stable.runtime.close();
    const process = new FakeProcess();
    process.handler = m => {
      if (m.id === undefined) return;
      process.response(m.id, m.method === 'thread/start' ? { thread: thread() } : m.method === 'turn/start' ? { turn: { id: 'turn', status: 'inProgress', items: [] } } : {});
    };
    const runtime = new CodexRuntime({ spawn: () => process, experimentalApi: true });
    await runtime.start(); await runtime.createThread();
    await runtime.send('t', 'question', { collaborationMode: mode });
    expect(process.messages[0].params.capabilities).toEqual({ experimentalApi: true });
    expect(process.messages.find(m => m.method === 'turn/start').params.collaborationMode).toEqual(mode);
    await runtime.close();
  });
  it('rejects failed handshake and cleans up process', async () => {
    const process = new FakeProcess();
    process.handler = m => process.emitMessage({ id: m.id, error: { code: -1, message: 'handshake refused' } });
    const runtime = new CodexRuntime({ spawn: () => process });
    await expect(runtime.start()).rejects.toThrow('handshake refused');
    await expect(runtime.createThread()).rejects.toThrow('Start Codex');
  });
  it('read hydrates history without resuming or permitting sends', async () => {
    const { runtime, process } = await setup();
    await runtime.readThread('t');
    await expect(runtime.send('t', 'hello')).rejects.toThrow('resume');
    expect(process.messages.some(m => m.method === 'thread/resume')).toBe(false);
    await runtime.close();
  });
  it('keeps receipt separate from completion and rejects competing sends', async () => {
    const { runtime, process } = await setup(); await runtime.createThread();
    await runtime.send('t', 'hello');
    expect(runtime.getSnapshot('t').execution).toBe('running');
    await expect(runtime.send('t', 'again')).rejects.toThrow('active');
    await expect(runtime.steer('t', 'continue', 'wrong')).rejects.toThrow('active');
    process.emitMessage({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'turn', status: 'completed', items: [] } } });
    expect(runtime.getSnapshot('t').execution).toBe('completed');
    await runtime.close();
  });
  it('routes approvals by original ID and thread, expires resolved replies', async () => {
    const { runtime, process } = await setup(); await runtime.createThread(); await runtime.send('t', 'hello');
    process.emitMessage({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 't', turnId: 'turn', itemId: 'cmd' } });
    expect(runtime.getSnapshot('t').execution).toBe('waitingApproval');
    await expect(runtime.reply('other', 'approval', { decision: 'decline' }, runtime.getSnapshot('t').epoch)).rejects.toThrow('another thread');
    await runtime.reply('t', 'approval', { decision: 'decline' }, runtime.getSnapshot('t').epoch);
    expect(process.messages.at(-1)).toEqual({ id: 'approval', result: { decision: 'decline' } });
    await expect(runtime.reply('t', 'approval', {}, runtime.getSnapshot('t').epoch)).rejects.toThrow('expired');
    process.emitMessage({ id: 42, method: 'item/tool/requestUserInput', params: { threadId: 't', turnId: 'turn', questions: [] } });
    expect(runtime.getSnapshot('t').execution).toBe('waitingInput');
    process.emitMessage({ method: 'serverRequest/resolved', params: { threadId: 't', requestId: 42 } });
    await expect(runtime.reply('t', 42, {}, runtime.getSnapshot('t').epoch)).rejects.toThrow('expired');
    await runtime.close();
  });
  it('responds to unsupported requests with a JSON-RPC error', async () => {
    const { runtime, process } = await setup();
    process.emitMessage({ id: 99, method: 'item/tool/call', params: { threadId: 't' } });
    expect(process.messages.at(-1)).toEqual({ id: 99, error: { code: -32601, message: 'Unsupported client request' } });
    await runtime.close();
  });
  it('marks disconnect as unknown and restart resumes without replaying input', async () => {
    const { runtime, process } = await setup(); await runtime.createThread(); await runtime.send('t', 'hello');
    process.emit('exit', 1);
    expect(runtime.getSnapshot('t')).toMatchObject({ connection: 'disconnected', execution: 'unknown' });
    await runtime.restart();
    expect(process.messages.filter(m => m.method === 'turn/start')).toHaveLength(1);
    expect(process.messages.filter(m => m.method === 'thread/resume')).toHaveLength(1);
    await runtime.close();
  });
  it('rejects delayed replies from the prior process even when request IDs repeat', async () => {
    const { runtime, process } = await setup(); await runtime.createThread();
    const epoch = runtime.getSnapshot('t').epoch;
    process.emit('exit', 1); await runtime.restart();
    process.emitMessage({ id: 7, method: 'item/fileChange/requestApproval', params: { threadId: 't', turnId: 'new' } });
    await expect(runtime.reply('t', 7, { decision: 'accept' }, epoch)).rejects.toThrow('epoch');
    expect(runtime.getSnapshot('t').requests).toHaveLength(1);
    await runtime.reply('t', 7, { decision: 'decline' }, runtime.getSnapshot('t').epoch);
    expect(process.messages.at(-1)).toEqual({ id: 7, result: { decision: 'decline' } });
    await runtime.close();
  });
  it.each(['completed', 'failed', 'interrupted'])('preserves proven %s if the start receipt times out', async status => {
    const { runtime, process } = await setup(); await runtime.createThread();
    process.handler = m => { if (m.method === 'turn/start') process.emitMessage({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'new', status, items: [] } } }); };
    await expect(runtime.send('t', 'hello')).rejects.toBeInstanceOf(UncertainOutcomeError);
    expect(runtime.getSnapshot('t').execution).toBe(status);
    await runtime.close();
  });
  it('ignores stale or replayed compaction lifecycle events', async () => {
    const { runtime, process } = await setup(); await runtime.createThread(); await runtime.send('t', 'hello');
    const compact = (method: string, turnId: string, id: string) => process.emitMessage({ method, params: { threadId: 't', turnId, item: { id, type: 'contextCompaction' } } });
    compact('item/started', 'turn', 'compact'); compact('item/completed', 'turn', 'compact');
    process.emitMessage({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'turn', status: 'completed', items: [] } } });
    compact('item/started', 'turn', 'compact'); compact('item/started', 'turn', 'late');
    expect(runtime.getSnapshot('t').execution).toBe('completed');
    process.emitMessage({ method: 'turn/started', params: { threadId: 't', turn: { id: 'new', status: 'inProgress', items: [] } } });
    compact('item/started', 'new', 'new-compact');
    compact('item/completed', 'turn', 'late');
    expect(runtime.getSnapshot('t').execution).toBe('compacting');
    compact('item/completed', 'new', 'new-compact');
    expect(runtime.getSnapshot('t').execution).toBe('running');
    await runtime.close();
  });
  it('reports timeout uncertainty without retrying a start request', async () => {
    const { runtime, process } = await setup(); await runtime.createThread();
    process.handler = () => {};
    await expect(runtime.send('t', 'hello')).rejects.toBeInstanceOf(UncertainOutcomeError);
    expect(runtime.getSnapshot('t').execution).toBe('unknown');
    expect(process.messages.filter(m => m.method === 'turn/start')).toHaveLength(1);
    await runtime.close();
  });
  it('preserves a terminal notification received before the start receipt', async () => {
    const { runtime, process } = await setup(); await runtime.createThread();
    process.handler = m => {
      process.emitMessage({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'turn', status: 'completed', items: [] } } });
      process.response(m.id, { turn: { id: 'turn', status: 'inProgress', items: [] } });
    };
    await runtime.send('t', 'hello');
    expect(runtime.getSnapshot('t').execution).toBe('completed');
    await runtime.close();
  });
});

describe('runtime state regressions', () => {
  it('uses bounded metadata history and handles only exact unmaterialized error', async () => {
    const { runtime, process } = await setup();
    process.handler = m => {
      if (m.method === 'thread/read') process.response(m.id, { thread: thread() });
      else if (m.method === 'thread/turns/list') process.emitMessage({ id: m.id, error: { code: -32600, message: 'thread t is not materialized yet; thread/turns/list is unavailable before first user message' } });
    };
    expect((await runtime.readThread('t')).thread.turns).toEqual([]);
    expect(process.messages.find(m => m.method === 'thread/read').params.includeTurns).toBe(false);
    expect(process.messages.find(m => m.method === 'thread/turns/list').params.limit).toBe(100);
    await runtime.close();
  });
  it('ignores terminal turn start replay and stale turn completion', async () => {
    const { runtime, process } = await setup(); await runtime.createThread();
    const emit = (method: string, id: string, status = 'inProgress') => process.emitMessage({ method, params: { threadId: 't', turn: { id, status, items: [] } } });
    emit('turn/started', 'old'); emit('turn/completed', 'old', 'completed'); emit('turn/started', 'old');
    expect(runtime.getSnapshot('t').execution).toBe('completed');
    emit('turn/started', 'new'); emit('turn/started', 'old'); emit('turn/completed', 'old', 'completed');
    expect(runtime.getSnapshot('t')).toMatchObject({ activeTurnId: 'new', execution: 'running' });
    await runtime.close();
  });
  it('tombstones a resolved request before the request arrives', async () => {
    const { runtime, process } = await setup();
    process.emitMessage({ method: 'serverRequest/resolved', params: { threadId: 't', requestId: 50 } });
    process.emitMessage({ id: 50, method: 'item/fileChange/requestApproval', params: { threadId: 't', turnId: 'turn' } });
    expect(runtime.getSnapshot('t').requests).toEqual([]);
    await expect(runtime.reply('t', 50, {}, runtime.getSnapshot('t').epoch)).rejects.toThrow('expired');
    await runtime.close();
  });
  it('clears compaction execution on item completion', async () => {
    const { runtime, process } = await setup(); await runtime.createThread(); await runtime.send('t', 'hello');
    const params = { threadId: 't', turnId: 'turn', item: { id: 'compact', type: 'contextCompaction' } };
    process.emitMessage({ method: 'item/started', params });
    expect(runtime.getSnapshot('t').execution).toBe('compacting');
    process.emitMessage({ method: 'item/completed', params });
    expect(runtime.getSnapshot('t').execution).toBe('running');
    await runtime.close();
  });
  it('preserves live waiting state racing resume history', async () => {
    const { runtime, process } = await setup();
    process.handler = m => {
      if (m.method === 'thread/resume') {
        process.emitMessage({ method: 'turn/started', params: { threadId: 't', turn: { id: 'active', status: 'inProgress', items: [] } } });
        process.emitMessage({ id: 'ask', method: 'item/tool/requestUserInput', params: { threadId: 't', turnId: 'active', questions: [] } });
        process.response(m.id, { thread: thread() });
      } else if (m.method === 'thread/turns/list') process.response(m.id, { data: [], nextCursor: null });
    };
    await runtime.resumeThread('t');
    expect(runtime.getSnapshot('t')).toMatchObject({ execution: 'waitingInput', activeTurnId: 'active' });
    await runtime.close();
  });
});

describe('runtime hydration and cache lifecycle', () => {
  it('preserves terminal live state when stale resume page arrives later', async () => {
    const { runtime, process } = await setup();
    process.handler = m => {
      if (m.method === 'thread/resume') process.response(m.id, { thread: thread() });
      else if (m.method === 'thread/turns/list') {
        process.emitMessage({ method: 'turn/started', params: { threadId: 't', turn: { id: 'active', status: 'inProgress', items: [] } } });
        process.emitMessage({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'active', status: 'completed', items: [] } } });
        process.response(m.id, { data: [{ id: 'active', status: 'inProgress', items: [] }], nextCursor: null });
      }
    };
    await runtime.resumeThread('t');
    expect(runtime.getSnapshot('t')).toMatchObject({ execution: 'completed', activeTurnId: 'active' });
    await runtime.close();
  });
  it('rejects server requests for a terminal or another active turn', async () => {
    const { runtime, process } = await setup(); await runtime.createThread();
    const turn = (method: string, id: string, status = 'inProgress') => process.emitMessage({ method, params: { threadId: 't', turn: { id, status, items: [] } } });
    const request = (id: number, turnId: string) => process.emitMessage({ id, method: 'item/fileChange/requestApproval', params: { threadId: 't', turnId } });
    turn('turn/started', 'old'); turn('turn/completed', 'old', 'completed'); request(1, 'old');
    expect(runtime.getSnapshot('t').requests).toEqual([]);
    expect(process.messages.at(-1).error.code).toBe(-32000);
    turn('turn/started', 'new'); request(2, 'old');
    expect(runtime.getSnapshot('t')).toMatchObject({ execution: 'running', activeTurnId: 'new', requests: [] });
    await runtime.close();
  });
  it('accepts a request before started and retains waiting state afterward', async () => {
    const { runtime, process } = await setup(); await runtime.createThread();
    process.emitMessage({ id: 88, method: 'item/fileChange/requestApproval', params: { threadId: 't', turnId: 'new' } });
    process.emitMessage({ method: 'turn/started', params: { threadId: 't', turn: { id: 'new', status: 'inProgress', items: [] } } });
    expect(runtime.getSnapshot('t')).toMatchObject({ execution: 'waitingApproval', activeTurnId: 'new' });
    await runtime.close();
  });
  it('releases only inactive unsubscribed caches', async () => {
    const { runtime, process } = await setup(); await runtime.createThread();
    const unsubscribe = runtime.subscribe('t', () => {});
    expect(runtime.releaseSession('t')).toBe(false);
    unsubscribe(); await runtime.send('t', 'hello');
    expect(runtime.releaseSession('t')).toBe(false);
    process.emitMessage({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'turn', status: 'completed', items: [] } } });
    expect(runtime.releaseSession('t')).toBe(true);
    expect(runtime.getSnapshot('t')).toMatchObject({ execution: 'idle', revision: 0 });
    await expect(runtime.send('t', 'again')).rejects.toThrow('resume');
    await runtime.close();
  });
});

describe('read-only saved execution state', () => {
  it('derives completion after restart without enabling send', async () => {
    const { runtime, process } = await setup();
    process.handler = m => {
      if (m.method === 'thread/read') process.response(m.id, { thread: { ...thread(), status: { type: 'notLoaded' } } });
      else if (m.method === 'thread/turns/list') process.response(m.id, { data: [{ id: 'saved', status: 'completed', items: [] }], nextCursor: null });
    };
    await runtime.readThread('t');
    expect(runtime.getSnapshot('t')).toMatchObject({ execution: 'completed', activeTurnId: 'saved' });
    await expect(runtime.send('t', 'continue')).rejects.toThrow('resume');
    await runtime.close();
  });
  it('marks persisted in-progress work unknown without live active evidence', async () => {
    const { runtime, process } = await setup();
    process.handler = m => {
      if (m.method === 'thread/read') process.response(m.id, { thread: { ...thread(), status: { type: 'notLoaded' } } });
      else if (m.method === 'thread/turns/list') process.response(m.id, { data: [{ id: 'saved', status: 'inProgress', items: [] }], nextCursor: null });
    };
    await runtime.readThread('t');
    expect(runtime.getSnapshot('t').execution).toBe('unknown');
    await runtime.close();
  });
});

describe('unmaterialized loaded threads', () => {
  it('reads and resumes newly created metadata without disk calls until first turn', async () => {
    const { runtime, process } = await setup();
    const created = await runtime.createThread();
    process.handler = m => {
      if (m.method === 'thread/read' || m.method === 'thread/resume') process.emitMessage({ id: m.id, error: { code: -32600, message: 'no rollout found for thread id t' } });
      else if (m.method === 'turn/start') process.response(m.id, { turn: { id: 'turn', status: 'inProgress', items: [] } });
    };
    expect(await runtime.readThread('t')).toBe(created);
    expect(await runtime.resumeThread('t')).toBe(created);
    expect(process.messages.some(m => m.method === 'thread/read' || m.method === 'thread/resume')).toBe(false);
    await runtime.send('t', 'hello');
    await expect(runtime.readThread('t')).rejects.toThrow('not persisted');
    await runtime.close();
  });
  it('does not reuse fresh metadata across process loss or replay input', async () => {
    const { runtime, process } = await setup(); await runtime.createThread();
    process.emit('exit', 1);
    process.handler = m => {
      if (m.method === 'initialize') process.response(m.id, {});
      else if (m.method === 'thread/resume') process.emitMessage({ id: m.id, error: { code: -32600, message: 'no rollout found for thread id t' } });
    };
    await expect(runtime.restart()).rejects.toThrow('create a new thread');
    expect(process.messages.some(m => m.method === 'turn/start')).toBe(false);
    await runtime.close();
  });
});

describe('process authority recovery', () => {
  it('reconciles a formerly live partial turn with persisted interruption', async () => {
    const { runtime, process } = await setup(); await runtime.createThread(); await runtime.send('t', 'hello');
    process.emitMessage({ method: 'turn/started', params: { threadId: 't', turn: { id: 'turn', status: 'inProgress', items: [] } } });
    process.emitMessage({ method: 'item/agentMessage/delta', params: { threadId: 't', turnId: 'turn', itemId: 'agent', delta: 'partial' } });
    process.emit('exit', 1);
    expect(runtime.getSnapshot('t').execution).toBe('unknown');
    expect(runtime.getSnapshot('t').events.some(e => e.type === 'turn_aborted')).toBe(false);
    process.handler = m => {
      if (m.method === 'initialize') process.response(m.id, {});
      else if (m.method === 'thread/resume') process.response(m.id, { thread: { ...thread(), status: { type: 'idle' } } });
      else if (m.method === 'thread/turns/list') process.response(m.id, { data: [{ id: 'turn', status: 'interrupted', items: [{ id: 'agent', type: 'agentMessage', text: 'partial' }] }], nextCursor: null });
    };
    await runtime.restart();
    expect(runtime.getSnapshot('t').execution).toBe('interrupted');
    expect(runtime.getSnapshot('t').events.some(e => e.type === 'turn_aborted' && e.turnId === 'turn')).toBe(true);
    expect(runtime.getSnapshot('t').events.find(e => e.type === 'agent_message')).toMatchObject({ text: 'partial', partial: false });
    await runtime.close();
  });
});

it('retains explicit thread policy and config when restart follows a partial resume override', async () => {
  const { runtime, process } = await setup();
  await runtime.createThread({ sandbox: 'workspace-write', approvalPolicy: 'on-request', config: { first: true } });
  await runtime.resumeThread('t', { config: { second: true } });
  await runtime.restart();
  expect(process.messages.filter(m => m.method === 'thread/resume').at(-1).params).toMatchObject({ sandbox: 'workspace-write', approvalPolicy: 'on-request', config: { first: true, second: true } });
  await runtime.close();
});
