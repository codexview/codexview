#!/usr/bin/env node
// Explicitly opt in: this uses real model quota. Never run from `pnpm test`.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { createServer as createHttpServer } from 'node:http';
import { CodexRuntime } from '../packages/runtime/dist/index.js';
import { sessionApiPlugin } from '../packages/react/playground/session-api.mjs';
if (!process.argv.includes('--run')) {
    console.log('Opt in with node scripts/accept-app-server.mjs --run [--interactive]. Builds required. --cases all|approvals|compaction|browser-compaction|network. --budget limits cumulative turn starts + compactions. --resume DIR resumes saved synthetic evidence; browser-compaction requires it. Browser-only cases print readiness/finish gate files.');
    process.exit(0);
}
const cases = process.argv.includes('--cases') ? process.argv[process.argv.indexOf('--cases') + 1] : 'all';
assert(['all', 'approvals', 'compaction', 'browser-compaction', 'network'].includes(cases), 'Unknown --cases value');
const budget = Number(process.argv.includes('--budget') ? process.argv[process.argv.indexOf('--budget') + 1] : 11);
assert(Number.isInteger(budget) && budget > 0, 'Positive integer --budget required');
const interactive = process.argv.includes('--interactive');
const resumeRoot = process.argv.includes('--resume') ? process.argv[process.argv.indexOf('--resume') + 1] : undefined;
const browserCompaction = cases === 'browser-compaction';
assert(!browserCompaction || resumeRoot, 'browser-compaction requires --resume with isolated synthetic evidence');
const root = resumeRoot ? resolve(resumeRoot) : await mkdtemp(join(tmpdir(), 'codexview-real-'));
const work = join(root, 'workspace');
const home = join(root, 'codex-home');
await mkdir(work, { recursive: true });
await mkdir(home, { recursive: true });
// Share only the login credential; no personal sessions/config/instructions are imported.
if (!resumeRoot)
    await symlink(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), join(home, 'auth.json'));
const model = process.env.CODEXVIEW_TEST_MODEL || 'gpt-6.1-sol';
const effort = 'medium';
const previous = resumeRoot ? JSON.parse(await readFile(join(root, 'summary.json'), 'utf8')) : undefined;
const report = previous ?? { cli: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(), model, effort, turnStarts: 0, compactions: 0, budget, cases: [], events: [], states: [], failures: [] };
if (previous) {
    report.budget = budget;
    report.previousFailures = [...(report.previousFailures || []), ...report.failures];
    report.failures = [];
}
if (browserCompaction) {
    // Early acceptance versions did not register their direct-runtime compaction
    // thread in the HTTP playground. Register only this explicit synthetic ID.
    const file = join(root, 'threads.json');
    const rows = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : [];
    if (!rows.some(row => row.id === report.compactionThreadId)) {
        rows.push({ id: report.compactionThreadId, name: 'Synthetic automatic compaction' });
        await writeFile(file, JSON.stringify(rows), { mode: 0o600 });
    }
}
for (const [name, flags] of [['stable', []], ['experimental', ['--experimental']]])
    execFileSync('codex', ['app-server', 'generate-ts', ...flags, '--out', join(root, 'schema-' + name)]);
const snapshots = createWriteStream(join(root, 'snapshots.jsonl'), { mode: 0o600, flags: 'a' });
function observe(id) { return runtime.subscribe(id, s => { states.add(s.execution); snapshots.write(JSON.stringify(s) + '\n'); }); }
const raw = createWriteStream(join(root, 'protocol.jsonl'), { mode: 0o600, flags: 'a' });
const incoming = [];
const outgoing = [];
const states = new Set();
const compactItems = new Set(report.compactionItems || []);
const initialBudgetUsed = report.turnStarts + report.compactions;
const initialCompactions = report.compactions;
const compactionLifecycle = [];
let child;
let networkTarget;
const runtime = new CodexRuntime({ experimentalApi: true, snapshotIntervalMs: 1, spawn: () => {
        child = spawn('codex', ['app-server', '--strict-config'], { cwd: work, env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
        createInterface({ input: child.stdout }).on('line', line => {
            const m = JSON.parse(line);
            incoming.push(m);
            raw.write(JSON.stringify({ direction: 'in', ...m }) + '\n');
            if (['item/started', 'item/completed'].includes(m.method) && m.params?.item?.type === 'contextCompaction')
                compactionLifecycle.push({ method: m.method, at: new Date().toISOString(), itemId: m.params.item.id, turnId: m.params.turnId });
            if (m.method === 'item/started' && m.params?.item?.type === 'contextCompaction' && !compactItems.has(m.params.item.id)) {
                compactItems.add(m.params.item.id);
                report.compactions++;
            }
        });
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = function (chunk, ...args) { for (const line of String(chunk).trim().split('\n')) {
            const m = JSON.parse(line);
            outgoing.push(m);
            raw.write(JSON.stringify({ direction: 'out', ...m }) + '\n');
        } return write(chunk, ...args); };
        return child;
    } });
process.env.CODEXVIEW_PLAYGROUND_ACCEPTANCE = '1';
const require = createRequire(new URL('../packages/react/package.json', import.meta.url));
const { createServer } = await import(require.resolve('vite'));
const react = (await import(require.resolve('@vitejs/plugin-react'))).default;
const threadOptions = {};
const defaultThreadOptions = { model, approvalPolicy: 'on-request', sandbox: 'read-only', config: { model_reasoning_effort: effort } };
const server = await createServer({ configFile: false, root: resolve('packages/react/playground'), plugins: [react(), sessionApiPlugin({ runtime, stateDir: root, threadOptions })], server: { host: '127.0.0.1', port: Number(process.env.CODEXVIEW_TEST_PORT || 5193), strictPort: true } });
await server.listen();
const url = `http://127.0.0.1:${server.config.server.port}`;
const { token } = await (await fetch(url + '/api/session/bootstrap')).json();
async function http(path, body) { const res = await fetch(url + '/api/session' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-codexview-token': token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const data = await res.json(); if (!res.ok)
    throw Error(data.error); return data; }
async function thread(options = {}) {
    Object.assign(threadOptions, defaultThreadOptions, options);
    const { threadId } = await http('/threads', {});
    observe(threadId);
    return threadId;
}
const wait = async (predicate, label, timeout = 600000) => { const until = Date.now() + timeout; while (!predicate()) {
    if (Date.now() > until)
        throw Error('Timeout: ' + label);
    await new Promise(r => setTimeout(r, 100));
} };
async function turn(id, prompt, options = {}) { assert(report.turnStarts + report.compactions < report.budget, 'Real model budget exhausted'); report.turnStarts++; await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2)); console.log('TURN', report.turnStarts, 'compactions', report.compactions); const start = incoming.length; const { turn } = await runtime.send(id, prompt, { model, effort, ...options }); await wait(() => incoming.slice(start).some(m => m.method === 'turn/completed' && m.params.turn.id === turn.id), 'turn completion'); const snapshot = runtime.getSnapshot(id); assert.equal(snapshot.execution, 'completed', snapshot.error); return { turn, snapshot, messages: incoming.slice(start), text: snapshot.events.filter(e => e.type === 'agent_message' && e.turnId === turn.id).map(e => e.text).join('\n') }; }
function passed(name, details) { report.cases.push({ name, result: 'passed', ...details }); console.log('PASS', name); }
console.log(JSON.stringify({ root, url, interactive, model, effort }));
await writeFile(join(root, 'location.json'), JSON.stringify({ root, url }));
try {
    if (cases === 'network') {
        assert(interactive, 'network requires explicit browser decisions with --interactive');
        const hits = [];
        networkTarget = createHttpServer((req, res) => { hits.push(req.url); res.end('SYNTHETIC_NETWORK_TARGET'); });
        await new Promise(resolve => networkTarget.listen(5196, '127.0.0.1', resolve));
        const id = await thread({ sandbox: 'workspace-write', approvalPolicy: 'on-request', config: {
            model_reasoning_effort: effort,
            'sandbox_workspace_write.network_access': true,
            'features.network_proxy.enabled': true,
            'features.network_proxy.proxy_url': 'http://127.0.0.1:5319',
            'features.network_proxy.enable_socks5': false,
            'features.network_proxy.allow_local_binding': true,
        } });
        const gate = join(root, `browser-ready-${process.pid}`);
        const finish = join(root, `browser-finished-${process.pid}`);
        console.log('NETWORK_BROWSER_READY', JSON.stringify({ root, url, threadId: id, gate, finish }));
        await writeFile(join(root, 'network-location.json'), JSON.stringify({ root, url, threadId: id, gate, finish }));
        await wait(() => existsSync(gate), 'network browser readiness gate', 1800000);
        const result = await turn(id, `Perform exactly two exec_command calls, sequentially, with login=false and no escalation. First run: curl --noproxy '' --max-time 90 http://127.0.0.1:5196/accept . Then run: curl --noproxy '' --max-time 90 http://localhost:5196/decline . These are isolated synthetic loopback targets. Do not change proxy variables, network policies or retry failures; after both calls report their outputs briefly.`, {});
        const requests = result.messages.filter(m => m.method === 'item/commandExecution/requestApproval' && m.params.networkApprovalContext);
        report.networkProbe = { requests: requests.map(m => ({ id: m.id, ...m.params.networkApprovalContext, decision: outgoing.find(o => o.id === m.id && o.result)?.result })), hits, text: result.text };
        await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2));
        console.log('NETWORK_RESULT', JSON.stringify(report.networkProbe));
        await wait(() => existsSync(finish), 'network browser finish gate', 1800000);
        assert(requests.length >= 2, 'Installed CLI did not produce both managed-network approvals; inspect networkProbe and raw protocol');
        assert.deepEqual(requests.map(m => outgoing.find(o => o.id === m.id && o.result)?.result.decision), ['accept', 'decline']);
        assert.deepEqual(hits, ['/accept']);
        passed('real managed-network browser approval accept/decline', report.networkProbe);
    }
    if (browserCompaction) {
        const cid = report.compactionThreadId;
        assert(cid, 'Saved compactionThreadId required');
        // A new process applies the lowered threshold to the existing synthetic history.
        // No compact RPC or fabricated lifecycle event is used.
        await runtime.start();
        await runtime.resumeThread(cid, { model, config: { model_reasoning_effort: effort, model_auto_compact_token_limit: 1000 } });
        observe(cid);
        const gate = join(root, `browser-ready-${process.pid}`);
        const finish = join(root, `browser-finished-${process.pid}`);
        console.log('BROWSER_READY', JSON.stringify({ url, threadId: cid, gate, finish, remainingBudget: budget - initialBudgetUsed }));
        await writeFile(join(root, 'browser-compaction-location.json'), JSON.stringify({ url, threadId: cid, gate, finish }));
        await wait(() => existsSync(gate), 'browser readiness gate', 1800000);
        assert(budget - initialBudgetUsed >= 2, 'Reserve one turn and one automatic compaction');
        const result = await turn(cid, 'Recall the permanent marker and value from this session. Reply only with them. Do not use tools.');
        assert(report.compactions > initialCompactions, 'No new automatic compaction');
        assert(report.turnStarts + report.compactions <= budget, 'Automatic compaction exceeded reserved budget');
        assert(states.has('compacting'), 'No live compacting snapshot');
        assert(result.text.includes('CV-COMPACT-7391') && result.text.includes('violet-lantern'), 'Marker recall failed');
        assert(!outgoing.some(m => /compact/i.test(m.method || '')), 'Manual compaction forbidden');
        report.browserCompaction = { threshold: 1000, addedBudgetUnits: report.turnStarts + report.compactions - initialBudgetUsed, lifecycle: compactionLifecycle, markerRecall: result.text, browserObservation: 'Record separately from coordinator evidence' };
        passed('real automatic compaction browser session prepared and completed', report.browserCompaction);
        await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2));
        await wait(() => existsSync(finish), 'browser finish gate', 1800000);
    }
    if (!resumeRoot && ['all', 'approvals'].includes(cases)) {
        const id = await thread();
        console.log('APPROVAL_THREAD', id);
        const decisionCounts = new Map();
        const seen = new Set();
        const unsub = runtime.subscribe(id, s => { if (interactive)
            return; for (const r of s.requests) {
            if (seen.has(r.id))
                continue;
            seen.add(r.id);
            const n = (decisionCounts.get(r.method) || 0) + 1;
            decisionCounts.set(r.method, n);
            void runtime.reply(id, r.id, { decision: n === 1 ? 'accept' : 'decline' }, s.epoch);
        } });
        const a = await turn(id, `Perform these four tool actions sequentially, even when one is denied. 1: Use exec_command with sandbox_permissions=require_escalated and justification to run 'printf COMMAND_ACCEPT'. 2: Use exec_command with sandbox_permissions=require_escalated and justification to run 'printf COMMAND_DECLINE'. 3: Use apply_patch to create ${join(work, 'accept.txt')} containing FILE_ACCEPT. 4: Use apply_patch to create ${join(work, 'decline.txt')} containing FILE_DECLINE. Request user approval for each restricted action. Do not work around a denial; just proceed to the next numbered action. Then report outcomes concisely.`);
        unsub();
        const approvals = [...new Map(a.messages.filter(m => m.id !== undefined && m.method?.endsWith('/requestApproval')).map(m => [m.id, m])).values()];
        for (const request of approvals)
            assert.equal(outgoing.filter(m => m.id === request.id && m.result).length, 1, 'Approval replied more than once');
        for (const kind of ['commandExecution', 'fileChange']) {
            const requests = approvals.filter(m => m.method.includes(kind));
            assert(requests.length >= 2, 'Missing ' + kind + ' approvals');
            const decisions = requests.map(r => outgoing.find(m => m.id === r.id && m.result)?.result?.decision);
            assert(decisions.includes('accept') && decisions.includes('decline'), 'Missing both ' + kind + ' decisions');
        }
        assert.equal((await readFile(join(work, 'accept.txt'), 'utf8')).trim(), 'FILE_ACCEPT');
        await assert.rejects(readFile(join(work, 'decline.txt')));
        passed('command and file approvals accepted/declined', { requests: approvals.map(m => m.method) });
        const qid = await thread();
        console.log('QUESTION_THREAD', qid);
        const qseen = new Set();
        const qunsub = runtime.subscribe(qid, s => { if (interactive)
            return; for (const r of s.requests) {
            if (r.method !== 'item/tool/requestUserInput' || qseen.has(r.id))
                continue;
            qseen.add(r.id);
            void runtime.reply(qid, r.id, { answers: Object.fromEntries(r.params.questions.map((q, i) => [q.id, { answers: [i === 0 ? 'Blue' : 'CUSTOM-4821'] }])) }, s.epoch);
        } });
        const q = await turn(qid, 'Use request_user_input now to ask two questions in one call: color with options Blue and Green; and deployment label with options Alpha and Beta allowing a free-form alternative. Then repeat both received answers verbatim in your final response. Do not execute commands.', { collaborationMode: { mode: 'plan', settings: { model, reasoning_effort: effort, developer_instructions: null } } });
        qunsub();
        assert(q.messages.some(m => m.method === 'item/tool/requestUserInput'));
        assert(q.text.includes('Blue') && q.text.includes('CUSTOM-4821'), 'Question answers missing');
        passed('real requestUserInput selection and free answer', { answers: ['Blue', 'CUSTOM-4821'] });
    }
    if (cases === 'all' && !resumeRoot) {
        const id = await thread({ sandbox: 'workspace-write', approvalPolicy: 'never' });
        assert(report.turnStarts + report.compactions < report.budget, 'Real model budget exhausted');
        report.turnStarts++;
        await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2));
        const start = incoming.length;
        const receipt = await runtime.send(id, 'Use exec_command to run touch running.signal && sleep 45 with yield_time_ms 1000. Remember marker CV-INTERRUPT-2718. Do not finish until the command completes.', { model, effort });
        await wait(() => existsSync(join(work, 'running.signal')) && incoming.slice(start).some(m => m.method === 'item/started' && m.params.item.type === 'commandExecution'), 'command started executing');
        await runtime.steer(id, 'Also remember CV-STEER-3141.', receipt.turn.id);
        await runtime.interrupt(id, receipt.turn.id);
        await wait(() => runtime.getSnapshot(id).execution === 'interrupted', 'interrupted terminal');
        const resumed = await turn(id, 'Repeat both markers you were asked to remember.');
        assert(resumed.text.includes('CV-INTERRUPT-2718') && resumed.text.includes('CV-STEER-3141'));
        passed('tool interruption, live steer, subsequent turn', { markers: ['CV-INTERRUPT-2718', 'CV-STEER-3141'] });
    }
    if (['all', 'compaction'].includes(cases)) {
        const cid = resumeRoot ? report.compactionThreadId : await thread({ sandbox: 'workspace-write', approvalPolicy: 'never', config: { model_reasoning_effort: effort, model_auto_compact_token_limit: 18000 } });
        assert(cid, 'Saved compactionThreadId required to resume');
        report.compactionThreadId = cid;
        await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2));
        const marker = 'CV-COMPACT-7391';
        if (resumeRoot) {
            await runtime.start();
            await runtime.resumeThread(cid, { config: { model_auto_compact_token_limit: 18000 } });
            observe(cid);
        }
        if (!resumeRoot) {
            const first = await turn(cid, `Remember permanent marker ${marker} and value violet-lantern. Reply only ACK.`);
            assert(first.text.includes('ACK'));
            const noise = Array.from({ length: 3200 }, (_, i) => `sample-${i}: synthetic blue green red`).join('\n');
            await turn(cid, `The following synthetic filler is disposable. Keep the permanent marker and value from the previous turn. After reading, reply with that marker and value only.\n${noise}`);
        }
        const compact = await turn(cid, 'Recall the permanent marker and value from this session. Reply only with them.');
        assert(report.compactions > 0, 'No automatic compaction observed');
        assert(compact.text.includes(marker) && compact.text.includes('violet-lantern'), 'Post-compaction recall failed');
        assert(states.has('compacting'), 'Store never exposed compacting');
        assert(!outgoing.some(m => /compact/i.test(m.method || '')), 'Manual compaction forbidden');
        passed('automatic compaction and marker recall', { compactions: report.compactions, marker });
        await runtime.resumeThread(cid, { config: { model_auto_compact_token_limit: 1000000 } });
        const continuation = await turn(cid, 'Repeat the permanent marker and value only.');
        assert(continuation.text.includes(marker) && continuation.text.includes('violet-lantern'));
        const before = runtime.getSnapshot(cid).events;
        await runtime.readThread(cid);
        const after = runtime.getSnapshot(cid).events;
        assert.equal(after.filter(e => e.type === 'agent_message').length, before.filter(e => e.type === 'agent_message').length, 'History duplicated live messages');
        await runtime.restart();
        const recovered = await turn(cid, 'After reconnect, repeat the permanent marker and value only.');
        assert(recovered.text.includes(marker) && recovered.text.includes('violet-lantern'));
        passed('continued turns, history/live deduplication, process restart recall', { marker });
    }
}
catch (error) {
    report.failures.push(String(error.stack || error));
    process.exitCode = 1;
    console.error(error);
}
finally {
    report.events = [...new Set([...report.events, ...incoming.map(m => m.method).filter(Boolean)])].sort();
    report.states = [...new Set([...report.states, ...states])];
    report.effectiveConfigurations = [...(report.effectiveConfigurations || []), ...incoming.filter(m => m.result?.model && m.result?.reasoningEffort).map(m => ({ model: m.result.model, effort: m.result.reasoningEffort }))];
    report.lastInputTokens = [...(report.lastInputTokens || []), ...incoming.filter(m => m.method === 'thread/tokenUsage/updated').map(m => m.params.tokenUsage.last.inputTokens)];
    report.compactionItems = [...compactItems];
    if (['all', 'compaction', 'browser-compaction'].includes(cases))
        report.automaticCompactionThreshold = browserCompaction ? 1000 : 18000;
    await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('EVIDENCE', join(root, 'summary.json'), 'BUDGET', report.turnStarts + report.compactions);
    await server.close();
    await runtime.close();
    networkTarget?.close();
    raw.end();
    snapshots.end();
}
