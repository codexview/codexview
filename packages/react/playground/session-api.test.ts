// @vitest-environment node
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- playground middleware is plain ESM.
import { sessionApiPlugin } from './session-api.mjs';

interface Snapshot {
  threadId: string; epoch: number; revision: number; connection: string;
  execution: string; requests: unknown[]; events: Record<string, unknown>[];
}
interface Frame { kind: string; snapshot?: Snapshot; state?: Omit<Snapshot, 'events'>; prefix?: number; events?: Record<string, unknown>[] }
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); });

async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), 'codexview-session-host-'));
  let listener: ((snapshot: Snapshot) => void) | undefined;
  const snapshot: Snapshot = {
    threadId: 'owned', epoch: 1, revision: 1, connection: 'connected', execution: 'running', requests: [],
    events: [
      { type: 'thread_started', threadId: 'owned', at: 0 },
      { type: 'turn_started', turnId: 'turn', at: 0 },
      { type: 'agent_message', turnId: 'turn', itemId: 'message', text: 'Hello', partial: true, at: 0 },
    ],
  };
  const unsubscribe = vi.fn();
  const runtime = {
    start: vi.fn(async () => {}), close: vi.fn(async () => {}),
    createThread: vi.fn(async () => ({ thread: { id: 'owned', turns: [] } })),
    readThread: vi.fn(async () => ({ thread: { id: 'owned', turns: [] } })),
    resumeThread: vi.fn(async () => ({ thread: { id: 'owned', turns: [] } })),
    listModels: vi.fn(async () => []), listTurns: vi.fn(async () => ({ data: [], nextCursor: null })),
    send: vi.fn(async () => ({})), steer: vi.fn(async () => ({})), interrupt: vi.fn(async () => ({})), reply: vi.fn(async () => {}),
    rpc: vi.fn(async () => ({})), getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((_id: string, callback: (snapshot: Snapshot) => void) => {
      listener = callback; callback(snapshot); return unsubscribe;
    }),
  };
  let middleware!: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  // Register precisely the middleware supplied to Vite, against a real loopback HTTP server.
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  sessionApiPlugin({ runtime, stateDir }).configureServer({
    httpServer: server,
    middlewares: { use: (next: typeof middleware) => { middleware = next; } },
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback socket');
  const port = address.port;
  const host = `127.0.0.1:${port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  disposers.push(async () => { await close(); await rm(stateDir, { recursive: true, force: true }); });
  async function http(path: string, options: { method?: string; headers?: IncomingHttpHeaders; body?: unknown } = {}) {
    const req = request({ hostname: '127.0.0.1', port, path: `/api/session${path}`, method: options.method ?? 'GET', headers: options.headers });
    const response = new Promise<IncomingMessage>((resolve, reject) => { req.once('response', resolve); req.once('error', reject); });
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
    const res = await response;
    let text = '';
    for await (const chunk of res) text += chunk;
    return { status: res.statusCode, body: text ? JSON.parse(text) : undefined };
  }
  const bootstrap = await http('/bootstrap');
  const headers = { 'x-codexview-token': bootstrap.body.token as string, origin: `http://${host}`, 'content-type': 'application/json' };
  async function own() { expect((await http('/threads', { method: 'POST', headers, body: {} })).status).toBe(200); }
  async function stream() {
    const req = request({ hostname: '127.0.0.1', port, path: '/api/session/threads/owned/events', headers });
    const response = new Promise<IncomingMessage>((resolve, reject) => { req.once('response', resolve); req.once('error', reject); });
    req.end();
    const res = await response;
    const queue: Frame[] = [];
    const waiters: ((frame: Frame) => void)[] = [];
    let buffer = '';
    res.on('data', chunk => {
      buffer += String(chunk);
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (!frame.startsWith('data: ')) continue;
        const parsed = JSON.parse(frame.slice(6)) as Frame;
        const waiter = waiters.shift();
        if (waiter) waiter(parsed); else queue.push(parsed);
      }
    });
    return {
      res, destroy: () => { res.destroy(); req.destroy(); },
      next: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<Frame>(resolve => waiters.push(resolve)),
    };
  }
  return { http, own, headers, host, runtime, unsubscribe, snapshot, stream, close, emit: (next: Snapshot) => listener?.(next) };
}

describe('local session host authorization and stream protocol', () => {
  it('requires loopback Host, same origin, same-site access and the process token before runtime access', async () => {
    const app = await fixture();
    expect((await app.http('/bootstrap', { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await app.http('/bootstrap', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await app.http('/bootstrap', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await app.http('/models')).status).toBe(403);
    expect((await app.http('/models', { headers: { 'x-codexview-token': 'wrong' } })).status).toBe(403);
    expect((await app.http('/models', { headers: { ...app.headers, origin: 'http://localhost' } })).status).toBe(403);
    expect((await app.http('/models', { headers: { ...app.headers, host: 'evil.example' } })).status).toBe(403);
    expect(app.runtime.start).not.toHaveBeenCalled();
    expect((await app.http('/models', { headers: app.headers })).status).toBe(200);
    expect(app.runtime.start).toHaveBeenCalledTimes(1);
    expect(app.runtime.listModels).toHaveBeenCalledTimes(1);
  });

  it('denies unowned threads and arbitrary RPC methods, and pins thread creation policy', async () => {
    const app = await fixture();
    for (const action of ['read', 'events']) expect((await app.http(`/threads/foreign/${action}`, { headers: app.headers })).status).toBe(404);
    expect((await app.http('/threads/foreign/resume', { method: 'POST', headers: app.headers, body: {} })).status).toBe(404);
    expect((await app.http('/rpc', { method: 'POST', headers: app.headers, body: { method: 'thread/read', params: { threadId: 'foreign' } } })).status).toBe(404);
    expect((await app.http('/threads', { method: 'POST', headers: app.headers, body: { cwd: '/', sandbox: 'danger-full-access', approvalPolicy: 'never' } })).status).toBe(200);
    expect((await app.http('/threads/owned/rpc', { method: 'POST', headers: app.headers, body: { method: 'command/exec' } })).status).toBe(404);
    expect(app.runtime.readThread).not.toHaveBeenCalled();
    expect(app.runtime.resumeThread).not.toHaveBeenCalled();
    expect(app.runtime.subscribe).not.toHaveBeenCalled();
    expect(app.runtime.rpc).not.toHaveBeenCalled();
    expect(app.runtime.createThread).toHaveBeenCalledWith(expect.objectContaining({ sandbox: 'workspace-write', approvalPolicy: 'on-request' }));
  });

  it('sends an initial snapshot, applies prefix patches without losing content, and resets on epoch change', async () => {
    const app = await fixture(); await app.own();
    const stream = await app.stream();
    expect(stream.res.statusCode).toBe(200);
    expect(stream.res.headers['content-type']).toBe('text/event-stream');
    const initial = await stream.next();
    expect(initial.kind).toBe('snapshot');
    expect(initial.snapshot).toEqual(app.snapshot);
    const changed = { ...app.snapshot, revision: 2, events: [
      app.snapshot.events[0]!, app.snapshot.events[1]!,
      { ...app.snapshot.events[2], text: 'Hello world', partial: false },
    ] };
    app.emit(changed);
    const patch = await stream.next();
    expect(patch.kind).toBe('patch'); expect(patch.prefix).toBe(2);
    const reconstructed = { ...patch.state, events: [...initial.snapshot!.events.slice(0, patch.prefix), ...patch.events!] };
    expect(reconstructed).toEqual(changed);
    const completed = { ...changed, revision: 3, execution: 'completed', events: [...changed.events, { type: 'turn_completed', turnId: 'turn', at: 1 }] };
    app.emit(completed);
    const appended = await stream.next();
    expect(appended.prefix).toBe(3);
    expect({ ...appended.state, events: [...reconstructed.events.slice(0, appended.prefix), ...appended.events!] }).toEqual(completed);
    app.emit({ ...completed, epoch: 2, revision: 0 });
    expect((await stream.next()).kind).toBe('snapshot');
    stream.destroy();
    await vi.waitFor(() => expect(app.unsubscribe).toHaveBeenCalledTimes(1));
    expect(app.runtime.close).not.toHaveBeenCalled();
    await app.close();
    expect(app.runtime.close).toHaveBeenCalledTimes(1);
  });
});

it('returns JSON for void replies and forwards the captured epoch', async () => {
  const host = await fixture(); await host.own();
  const response = await host.http('/threads/owned/reply', { method: 'POST', headers: host.headers, body: { requestId: 3, result: { decision: 'decline' }, epoch: 'captured' } });
  expect(response).toEqual({ status: 200, body: {} });
  expect(host.runtime.reply).toHaveBeenCalledWith('owned', 3, { decision: 'decline' }, 'captured');
});
