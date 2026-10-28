import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createElement, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { adapt, parseJsonl, AppServerTranscriptStore } from '@codexview/adapters';
import { CodexRuntime } from '@codexview/runtime';
// Import before creating a DOM to catch browser-only code in the published entry.
import { CodexTranscript, CodexSession, Markdown, SearchBlock, VERSION } from '@codexview/react';

const versions = {};
for (const key of ['adapters', 'runtime', 'cli', 'react']) {
  const directory = new URL(`node_modules/@codexview/${key}/`, import.meta.url);
  assert(!lstatSync(directory).isSymbolicLink(), `${key} must be an installed tarball`);
  versions[key] = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8')).version;
}
assert.equal(VERSION, versions.react);
assert.equal(typeof CodexSession, 'function');
const jsonl = [
  { type: 'thread.started', thread_id: 'package-check' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'message', type: 'agent_message', text: 'Packaged release works.' } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
].map(line => JSON.stringify(line)).join('\n');
const { format, events } = adapt(parseJsonl(jsonl));
assert.equal(format, 'codex-exec');
assert(events.some(event => event.type === 'agent_message' && event.text === 'Packaged release works.'));
const store = new AppServerTranscriptStore('check');
store.apply('item/agentMessage/delta', { threadId: 'check', turnId: 'turn', itemId: 'a', delta: 'partial' });
store.apply('item/completed', { threadId: 'check', turnId: 'turn', item: { id: 'a', type: 'agentMessage', text: 'final' } });
assert.equal(store.getEvents().filter(event => event.type === 'agent_message').length, 1);
assert.equal(store.getEvents().find(event => event.type === 'agent_message').text, 'final');

const cli = fileURLToPath(new URL('node_modules/@codexview/cli/bin/codexview-md.mjs', import.meta.url));
for (const flag of ['-v', '--version']) {
  const result = spawnSync(process.execPath, [cli, flag], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `codexview-md ${versions.cli}`);
}
const rendered = spawnSync(process.execPath, [cli, '-'], { input: jsonl, encoding: 'utf8' });
assert.equal(rendered.status, 0, rendered.stderr);
assert(rendered.stdout.includes('Packaged release works.'));

assert.equal(typeof globalThis.document, 'undefined');
assert(renderToStaticMarkup(createElement(CodexTranscript, { events, disableSmoothStream: true })).includes('Packaged release works.'));
assert(renderToStaticMarkup(createElement(Markdown, {}, '**safe & sound**')).includes('<strong>safe &amp; sound</strong>'));
assert(!renderToStaticMarkup(createElement(Markdown, {}, '::git-create-pr{url="javascript:alert(1)"}')).includes('<a '));
assert(renderToStaticMarkup(createElement(Markdown, {}, '::constructor{}')).includes('constructor'));
assert(!renderToStaticMarkup(createElement(SearchBlock, { defaultOpen: true, item: {
  id: 's', kind: 'search', status: 'completed', startedAt: 0, updatedAt: 0,
  query: 'test', results: [{ title: 'Untrusted result', url: 'javascript:alert(1)' }],
} })).includes('<a '));
assert(readFileSync(new URL(import.meta.resolve('@codexview/react/styles.css')), 'utf8').includes('cv-'));

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const app = createRoot(document.getElementById('root'));
await act(async () => app.render(createElement(CodexTranscript, { events, disableSmoothStream: true })));
assert(document.body.textContent.includes('Packaged release works.'));
assert(document.querySelector('[role="log"]'));
await act(async () => app.unmount());
dom.window.close();

// Scripted child process only; no Codex process, model, or external request.
const runtime = new CodexRuntime({
  spawn: () => spawn(process.execPath, [fileURLToPath(new URL('network-app-server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] }),
  requestTimeoutMs: 3000, snapshotIntervalMs: 0,
});
const waitFor = async predicate => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert(Date.now() < deadline, 'runtime protocol timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
try {
  await runtime.start();
  const { thread } = await runtime.createThread();
  await runtime.send(thread.id, 'decline-after-restart');
  await waitFor(() => runtime.getSnapshot(thread.id).requests.length === 1);
  const snapshot = runtime.getSnapshot(thread.id);
  assert.equal(snapshot.execution, 'waitingApproval');
  await runtime.reply(thread.id, snapshot.requests[0].id, { decision: 'decline' }, snapshot.epoch);
  await waitFor(() => runtime.getSnapshot(thread.id).execution === 'completed');
  assert.equal(runtime.getSnapshot(thread.id).requests.length, 0);
} finally {
  await runtime.close();
}
console.log(JSON.stringify({ versions, adapters: 'passed', cli: 'passed', reactSSR: 'passed', reactDOM: 'passed', safeLinks: 'passed', css: 'passed', runtimeProtocol: 'passed' }));
