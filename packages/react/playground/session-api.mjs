import { CodexRuntime } from '@codexview/runtime';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

// Local development host only. Production hosts must supply user authentication,
// thread ownership checks and their own durable session store.
export function sessionApiPlugin(options = {}) {
  const root = resolve(options.stateDir || process.env.CODEXVIEW_PLAYGROUND_DIR || join(homedir(), '.codexview/playground'));
  const acceptance = process.env.CODEXVIEW_PLAYGROUND_ACCEPTANCE === '1';
  const token = randomBytes(32).toString('hex');
  const known = new Map();
  const runtime = options.runtime ?? new CodexRuntime({ maxTurns: 40, experimentalApi: acceptance });
  let ready;
  let persistence = Promise.resolve();
  async function init() {
    await mkdir(join(root, 'workspace'), { recursive: true });
    try {
      for (const row of JSON.parse(await readFile(join(root, 'threads.json'), 'utf8'))) known.set(row.id, row);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await runtime.start();
  }
  function save() {
    persistence = persistence.catch(() => {}).then(async () => {
      await writeFile(join(root, 'threads.json.tmp'), JSON.stringify([...known.values()]), { mode: 0o600 });
      await rename(join(root, 'threads.json.tmp'), join(root, 'threads.json'));
    });
    return persistence;
  }
  return {
    name: 'codexview-session-api',
    configureServer(server) {
      server.httpServer?.once('close', () => { void runtime.close(); });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/session')) return next();
        const json = (status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
        try {
          const host = req.headers.host || '';
          if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return json(403, { error: 'Loopback host required' });
          if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(403, { error: 'Same origin required' });
          if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Cross-site access denied' });
          const url = new URL(req.url, `http://${host}`);
          const path = url.pathname.slice('/api/session'.length);
          if (path === '/bootstrap' && req.method === 'GET') return json(200, { token });
          if (req.headers['x-codexview-token'] !== token) return json(403, { error: 'Local session token required' });
          await (ready ??= init().catch(error => { ready = undefined; throw error; }));
          if (path === '/models' && req.method === 'GET') return json(200, await runtime.listModels());
          if (path === '/threads' && req.method === 'GET') return json(200, [...known.values()]);
          let body = {};
          if (req.method === 'POST') {
            let raw = '';
            for await (const chunk of req) { raw += chunk; if (raw.length > 65536) return json(413, { error: 'Request too large' }); }
            body = JSON.parse(raw || '{}');
          }
          if (path === '/threads' && req.method === 'POST') {
            const result = await runtime.createThread({ cwd: join(root, 'workspace'), sandbox: 'workspace-write', approvalPolicy: 'on-request', ...(acceptance ? { baseInstructions: 'You are a test assistant in an isolated synthetic workspace. Follow the user precisely; do not read outside the workspace.', config: { model_reasoning_effort: 'medium' } } : {}), ...options.threadOptions });
            const thread = result.thread ?? result;
            known.set(thread.id, { id: thread.id, name: `Session ${new Date().toLocaleString()}` });
            await save();
            return json(200, { threadId: thread.id });
          }
          const match = /^\/threads\/([^/]+)\/(events|read|history|resume|send|steer|interrupt|reply)$/.exec(path);
          if (!match) return json(404, { error: 'Unknown session operation' });
          const [, threadId, action] = match;
          if (!known.has(threadId)) return json(404, { error: 'Thread does not belong to this playground' });
          if (action === 'events' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
            res.write(': connected\n\n');
            // Runtime subscription sends the current snapshot, making refresh/reconnect
            // independent of any previous browser's event cursor.
            let previous;
            const unsubscribe = runtime.subscribe(threadId, snapshot => {
              let frame = { kind: 'snapshot', snapshot };
              if (previous && previous.epoch === snapshot.epoch) {
                let prefix = 0;
                while (prefix < previous.events.length && prefix < snapshot.events.length && previous.events[prefix] === snapshot.events[prefix]) prefix++;
                const { events, ...state } = snapshot;
                frame = { kind: 'patch', state, prefix, events: events.slice(prefix) };
              }
              previous = snapshot;
              if (!res.destroyed && res.writableLength < 1024 * 1024) res.write(`data: ${JSON.stringify(frame)}\n\n`);
              else res.destroy();
            });
            const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
            res.once('close', () => { clearInterval(heartbeat); unsubscribe(); });
            return;
          }
          if (action === 'history' && req.method === 'GET') return json(200, await runtime.listTurns(threadId, { limit: 20, sortDirection: 'desc', cursor: url.searchParams.get('cursor') }));
          if (action === 'read' && req.method === 'GET') return json(200, await runtime.readThread(threadId));
          if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
          if (action === 'resume') { await runtime.start(); return json(200, await runtime.resumeThread(threadId)); }
          if (action === 'send' || action === 'steer') {
            if (typeof body.text !== 'string' || !body.text.trim()) return json(400, { error: 'Text required' });
            if (action === 'steer') {
              if (typeof body.expectedTurnId !== 'string') return json(400, { error: 'Expected turn ID required' });
              return json(200, await runtime.steer(threadId, body.text, body.expectedTurnId));
            }
            const options = {};
            if (typeof body.model === 'string') options.model = body.model;
            if (typeof body.effort === 'string') options.effort = body.effort;
            if (body.collaborationMode !== undefined) {
              if (!acceptance || !['plan', 'default'].includes(body.collaborationMode?.mode) || typeof body.collaborationMode?.settings?.model !== 'string') return json(400, { error: 'Experimental collaboration mode requires acceptance profile' });
              options.collaborationMode = body.collaborationMode;
            }
            return json(200, await runtime.send(threadId, body.text, options));
          }
          if (action === 'interrupt') return json(200, await runtime.interrupt(threadId, body.turnId));
          if (action === 'reply') { await runtime.reply(threadId, body.requestId, body.result, body.epoch); return json(200, {}); }
          return json(405, { error: 'Method not allowed' });
        } catch (error) { if (!res.headersSent) json(400, { error: error.message }); else res.end(); }
      });
    },
  };
}
