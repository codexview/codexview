import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('..', import.meta.url));

function command(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'codexview-release-dispatch-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'repo'), remote = join(temp, 'remote.git'), bin = join(temp, 'bin'), trace = join(temp, 'gh-trace');
  mkdirSync(root); mkdirSync(bin);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'packages/runtime'), { recursive: true });
  copyFileSync(join(source, 'scripts/release-package.sh'), join(root, 'scripts/release-package.sh'));
  copyFileSync(join(source, 'packages/runtime/release.sh'), join(root, 'packages/runtime/release.sh'));
  writeFileSync(join(root, 'packages/runtime/package.json'), JSON.stringify({ name: '@codexview/runtime', version: '0.7.0' }));
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'npm'), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'view' && args[1] === '@codexview/runtime@latest') { console.log('0.7.0'); process.exit(0); }
process.exit(1);
`, { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_GH_TRACE, args.join(' ') + '\\n');
if (args[0] === 'workflow' && args[1] === 'run' && process.env.TEST_DISPATCH_FAIL === '1') process.exit(1);
if (args[0] === 'run' && args[1] === 'list') console.log('123');
`, { mode: 0o755 });
  command(root, 'git', ['init', '--quiet', '-b', 'main']);
  command(root, 'git', ['add', '.']);
  command(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'baseline']);
  command(temp, 'git', ['init', '--quiet', '--bare', remote]);
  command(root, 'git', ['remote', 'add', 'origin', remote]);
  command(root, 'git', ['push', '--quiet', '-u', 'origin', 'main']);
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, TEST_GH_TRACE: trace };
  return {
    root, trace,
    run(extra) {
      return spawnSync(join(root, 'packages/runtime/release.sh'), ['0.7.0', '--publish'], {
        cwd: root, env: { ...env, ...extra }, encoding: 'utf8',
      });
    },
    calls() { return readFileSync(trace, 'utf8').trim().split('\n'); },
  };
}

test('GitHub automation dispatches the trusted workflow at the new tag', t => {
  const f = fixture(t);
  const r = f.run({ GITHUB_ACTIONS: 'true', CODEXVIEW_DISPATCH_RELEASE_WORKFLOW: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert(f.calls().includes('workflow run publish-runtime.yml --repo codexview/codexview --ref runtime-v0.7.0'));
  assert(f.calls().some(x => x.startsWith('run watch 123 ')));
  assert.match(r.stdout, /Published and verified/);
});

test('a human-operated release relies on the tag push rather than dispatch', t => {
  const f = fixture(t);
  const r = f.run({ GITHUB_ACTIONS: '', CODEXVIEW_DISPATCH_RELEASE_WORKFLOW: '' });
  assert.equal(r.status, 0, r.stderr);
  assert(!f.calls().some(x => x.startsWith('workflow run ')));
});

test('failed dispatch stops before claiming publication', t => {
  const f = fixture(t);
  const r = f.run({ GITHUB_ACTIONS: 'true', CODEXVIEW_DISPATCH_RELEASE_WORKFLOW: '1', TEST_DISPATCH_FAIL: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /inspect runtime-v0\.7\.0 and its workflow/);
  assert(!f.calls().some(x => x.startsWith('run watch ')));
  assert.doesNotMatch(r.stdout, /Published and verified/);
});

test('dispatch outside GitHub Actions fails before creating a tag', t => {
  const f = fixture(t);
  const r = f.run({ GITHUB_ACTIONS: '', CODEXVIEW_DISPATCH_RELEASE_WORKFLOW: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /restricted to GitHub Actions/);
  assert.equal(command(f.root, 'git', ['tag', '--list', 'runtime-v0.7.0']), '');
});
