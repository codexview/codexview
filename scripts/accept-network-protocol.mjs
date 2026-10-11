#!/usr/bin/env node
// Explicit controlled JSON-RPC -> runtime -> HTTP -> browser acceptance. Zero model calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { CodexRuntime } from '../packages/runtime/dist/index.js';
import { sessionApiPlugin } from '../packages/react/playground/session-api.mjs';

if (!process.argv.includes('--run')) {
  console.log('node scripts/accept-network-protocol.mjs --run [--interactive]; controlled subprocess, no Codex/model/network proxy. Builds required.');
  process.exit(0);
}
const interactive = process.argv.includes('--interactive');
const root = await mkdtemp(join(tmpdir(), 'codexview-network-protocol-'));
const protocol = createWriteStream(join(root, 'protocol.jsonl'), { mode: 0o600 });
const snapshots = createWriteStream(join(root, 'snapshots.jsonl'), { mode: 0o600 });
const wire = [];
const report = { kind: interactive ? 'controlled protocol/browser E2E' : 'controlled protocol/HTTP E2E', realCodex: false, modelBudgetUnits: 0, interactive, cases: [], failures: [] };
let generation = 0;
const runtime = new CodexRuntime({ snapshotIntervalMs: 1, spawn: () => {
  const current = ++generation;
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/network-app-server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  function record(direction, message) { const entry = { direction, generation: current, ...message }; wire.push(entry); protocol.write(JSON.stringify(entry) + '\n'); }
  createInterface({ input: child.stdout }).on('line', line => record('in', JSON.parse(line)));
  const write = child.stdin.write.bind(child.stdin);
  child.stdin.write = (chunk, ...args) => { for (const line of String(chunk).trim().split('\n')) record('out', JSON.parse(line)); return write(chunk, ...args); };
  return child;
} });
const require = createRequire(new URL('../packages/react/package.json', import.meta.url));
const { createServer } = await import(require.resolve('vite'));
const react = (await import(require.resolve('@vitejs/plugin-react'))).default;
const server = await createServer({ configFile: false, root: resolve('packages/react/playground'), plugins: [react(), sessionApiPlugin({ runtime, stateDir: root })], server: { host: '127.0.0.1', port: Number(process.env.CODEXVIEW_TEST_PORT || 5197), strictPort: true } });
await server.listen();
const url = `http://127.0.0.1:${server.config.server.port}`;
const { token } = await (await fetch(url + '/api/session/bootstrap')).json();
async function http(path, body, status = 200) {
  const response = await fetch(url + '/api/session' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-codexview-token': token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
const wait = async (test, name) => { const until = Date.now() + 1800000; while (!test()) { assert(Date.now() < until, 'Timeout: ' + name); await new Promise(resolve => setTimeout(resolve, 100)); } };
try {
  const { threadId } = await http('/threads', {});
  runtime.subscribe(threadId, snapshot => snapshots.write(JSON.stringify(snapshot) + '\n'));
  const gate = join(root, 'browser-ready');
  const finish = join(root, 'browser-finished');
  const location = { root, url, threadId, gate, finish, kind: report.kind };
  console.log('CONTROLLED_BROWSER_READY', JSON.stringify(location));
  await writeFile(join(root, 'location.json'), JSON.stringify(location, null, 2));
  if (interactive) await wait(() => existsSync(gate), 'browser ready');
  let previousEpoch;
  for (const [scenario, decision] of [['accept-before-restart', 'accept'], ['decline-after-restart', 'decline']]) {
    if (previousEpoch) await runtime.restart();
    await http(`/threads/${threadId}/send`, { text: scenario });
    await wait(() => runtime.getSnapshot(threadId).requests.length === 1, 'approval request');
    const snapshot = runtime.getSnapshot(threadId);
    const request = snapshot.requests[0];
    const reply = { requestId: request.id, epoch: snapshot.epoch, result: { decision } };
    const replies = () => wire.filter(m => m.direction === 'out' && m.generation === generation && m.id === request.id && m.result);
    assert.equal(replies().length, 0, 'No automatic reply');
    assert.equal(request.id, 'network-approval:7');
    const missing = await http(`/threads/${threadId}/reply`, { ...reply, epoch: undefined }, 400);
    assert.match(missing.error, /epoch/);
    if (previousEpoch) {
      assert.notEqual(snapshot.epoch, previousEpoch);
      const stale = await http(`/threads/${threadId}/reply`, { ...reply, epoch: previousEpoch }, 400);
      assert.match(stale.error, /epoch/);
      assert.equal(replies().length, 0, 'Stale epoch leaked a response');
    }
    console.log('AWAIT_BROWSER_DECISION', JSON.stringify({ scenario, decision, requestId: request.id, epoch: snapshot.epoch, ...request.params.networkApprovalContext }));
    if (!interactive) await http(`/threads/${threadId}/reply`, reply);
    await wait(() => runtime.getSnapshot(threadId).execution === 'completed', 'explicit browser reply');
    assert.equal(replies().length, 1);
    assert.deepEqual(replies()[0].result, { decision });
    const duplicate = await http(`/threads/${threadId}/reply`, reply, 400);
    assert.match(duplicate.error, /expired|already answered/);
    assert.equal(replies().length, 1, 'Duplicate response leaked to subprocess');
    report.cases.push({ scenario, requestId: request.id, epoch: snapshot.epoch, networkApprovalContext: request.params.networkApprovalContext, decision, responseCount: replies().length, missingEpochRejected: true, staleEpochRejected: !!previousEpoch, duplicateRejected: true });
    previousEpoch = snapshot.epoch;
  }
  console.log('PASS', JSON.stringify(report));
  await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2));
  if (interactive) await wait(() => existsSync(finish), 'browser finished');
} catch (error) {
  report.failures.push(String(error.stack || error));
  process.exitCode = 1;
  console.error(error);
} finally {
  await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2));
  await server.close();
  await runtime.close();
  protocol.end();
  snapshots.end();
  console.log('EVIDENCE', root);
}
