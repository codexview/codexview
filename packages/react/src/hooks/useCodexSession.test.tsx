import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot, SessionTransport } from '@codexview/adapters';
import { useCodexSession } from './useCodexSession.js';

const snapshot = (threadId: string): SessionSnapshot => ({ threadId, revision: 1, connection: 'connected', execution: 'waitingApproval', events: [], requests: [{ id: 'original', method: 'item/commandExecution/requestApproval', threadId, params: {} }] });
it('keeps failures retryable and suppresses a duplicate in-flight reply', async () => {
  let reject!: (reason: Error) => void;
  const transport: SessionTransport = {
    subscribe: (_id, listener) => { listener(snapshot('thread')); return () => {}; },
    models: async () => [], send: async () => {}, steer: async () => {}, interrupt: async () => {},
    reply: vi.fn(() => new Promise((_resolve, nextReject) => { reject = nextReject; })),
  };
  const { result } = renderHook(() => useCodexSession({ threadId: 'thread', transport }));
  let first!: Promise<unknown>;
  act(() => { first = result.current.reply('original', { decision: 'decline' }).catch(() => {}); });
  await act(async () => { await result.current.reply('original', { decision: 'accept' }); });
  expect(transport.reply).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('Temporary failure')); await first; });
  expect(result.current.pendingRequestIds.size).toBe(0);
  expect(result.current.resolvedRequestIds.size).toBe(0);
  expect(result.current.actionError).toBe('Temporary failure');
});

describe('session subscription lifetime', () => {
  it('unsubscribes and ignores old-thread snapshots and actions', async () => {
    const listeners = new Map<string, (state: SessionSnapshot) => void>();
    const unsubscribe = vi.fn();
    let resolve!: (value: unknown) => void;
    const transport: SessionTransport = {
      subscribe: (id, listener) => { listeners.set(id, listener); listener(snapshot(id)); return unsubscribe; },
      models: async () => [], send: () => new Promise(next => { resolve = next; }), steer: async () => {}, interrupt: async () => {}, reply: async () => {},
    };
    const { result, rerender } = renderHook(({ threadId }) => useCodexSession({ threadId, transport }), { initialProps: { threadId: 'thread' } });
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.send('old'); });
    rerender({ threadId: 'next' });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    act(() => { listeners.get('thread')?.({ ...snapshot('thread'), revision: 99 }); });
    expect(result.current.snapshot.threadId).toBe('next');
    await act(async () => { resolve({}); await pending; });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.snapshot.threadId).toBe('next');
  });
});

describe('runtime epochs', () => {
  it('accepts restarted revision, clears responses and ignores retired snapshots', async () => {
    let listener!: (state: SessionSnapshot) => void;
    const transport: SessionTransport = {
      subscribe: (_id, next) => { listener = next; return () => {}; },
      models: async () => [], send: async () => {}, steer: async () => {}, interrupt: async () => {}, reply: vi.fn(async () => {}),
    };
    const { result } = renderHook(() => useCodexSession({ threadId: 'thread', transport }));
    act(() => listener({ ...snapshot('thread'), revision: 99, epoch: 'old' }));
    await act(async () => { await result.current.reply('original', { decision: 'decline' }); });
    expect(result.current.resolvedRequestIds.size).toBe(1);
    act(() => listener({ ...snapshot('thread'), revision: 1, epoch: 'new' }));
    expect(result.current.snapshot.revision).toBe(1);
    expect(result.current.resolvedRequestIds.size).toBe(0);
    act(() => listener({ ...snapshot('thread'), revision: 100, epoch: 'old' }));
    expect(result.current.snapshot.epoch).toBe('new');
    await act(async () => { await result.current.reply('original', { decision: 'accept' }); });
    expect(transport.reply).toHaveBeenCalledTimes(2);
  });

  it('does not resolve a reused request ID when an old epoch reply finishes', async () => {
    let listener!: (state: SessionSnapshot) => void;
    let finish!: (value: unknown) => void;
    const transport: SessionTransport = {
      subscribe: (_id, next) => { listener = next; return () => {}; },
      models: async () => [], send: async () => {}, steer: async () => {}, interrupt: async () => {},
      reply: vi.fn(() => new Promise(resolve => { finish = resolve; })),
    };
    const { result } = renderHook(() => useCodexSession({ threadId: 'thread', transport }));
    act(() => listener({ ...snapshot('thread'), revision: 99, epoch: 'old' }));
    let reply!: Promise<unknown>;
    act(() => { reply = result.current.reply('original', { decision: 'decline' }); });
    expect(result.current.pendingRequestIds.size).toBe(1);
    act(() => listener({ ...snapshot('thread'), revision: 1, epoch: 'new' }));
    await act(async () => { finish({}); await reply; });
    expect(result.current.pendingRequestIds.size).toBe(0);
    expect(result.current.resolvedRequestIds.size).toBe(0);
    expect(result.current.busy).toBe(false);
  });
});

it('rejects a reply callback retained by an old render after request ID reuse', async () => {
  let listener!: (state: SessionSnapshot) => void;
  const transport: SessionTransport = {
    subscribe: (_id, next) => { listener = next; return () => {}; },
    models: async () => [], send: async () => {}, steer: async () => {}, interrupt: async () => {}, reply: vi.fn(async () => {}),
  };
  const { result } = renderHook(() => useCodexSession({ threadId: 'thread', transport }));
  act(() => listener({ ...snapshot('thread'), epoch: 'old' }));
  const oldReply = result.current.reply;
  act(() => listener({ ...snapshot('thread'), epoch: 'new' }));
  await expect(oldReply('original', { decision: 'accept' })).rejects.toThrow('expired session');
  expect(transport.reply).not.toHaveBeenCalled();
  await act(async () => { await result.current.reply('original', { decision: 'decline' }); });
  expect(transport.reply).toHaveBeenCalledWith('thread', 'original', { decision: 'decline' }, 'new');
});
