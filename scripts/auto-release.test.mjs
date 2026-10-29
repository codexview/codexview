import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./auto-release.mjs', import.meta.url));
const entries = [
  ['adapters', 'adapters-v'], ['runtime', 'runtime-v'], ['cli', 'cli-v'], ['react', 'v'],
];

function command(cwd, cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'codexview-auto-release-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'repo');
  const bin = join(temp, 'bin');
  const trace = join(temp, 'trace');
  mkdirSync(root); mkdirSync(bin);
  command(root, 'git', ['init', '--quiet', '-b', 'main']);
  for (const [key] of entries) {
    const dir = join(root, 'packages', key);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@codexview/${key}`, version: '1.2.3' }));
    writeFileSync(join(dir, 'src/index.js'), 'export const value = 1;\n');
    writeFileSync(join(dir, 'release.sh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const key = path.basename(__dirname);
fs.appendFileSync(process.env.TEST_RELEASE_TRACE, [key, ...process.argv.slice(2), process.env.CODEXVIEW_DISPATCH_RELEASE_WORKFLOW].join(' ') + '\\n');
if (key === process.env.TEST_FAIL_RELEASE) process.exit(7);
`, { mode: 0o755 });
  }
  writeFileSync(join(bin, 'npm'), `#!/usr/bin/env node
const versions = JSON.parse(process.env.TEST_REGISTRY_VERSIONS);
const match = /^(@codexview\\/[^@]+)@latest$/.exec(process.argv[3] || '');
if (process.argv[2] !== 'view' || !match || !versions[match[1]]) process.exit(1);
console.log(versions[match[1]]);
`, { mode: 0o755 });
  command(root, 'git', ['add', '.']);
  command(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'baseline']);
  for (const [, prefix] of entries) command(root, 'git', ['tag', `${prefix}1.2.3`]);
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    GITHUB_ACTIONS: 'true',
    TEST_RELEASE_TRACE: trace,
    TEST_REGISTRY_VERSIONS: JSON.stringify(Object.fromEntries(entries.map(([key]) => [`@codexview/${key}`, '1.2.3']))),
  };
  return {
    root, trace, env,
    change(keys) {
      for (const key of keys) writeFileSync(join(root, 'packages', key, 'src/index.js'), 'export const value = 2;\n');
      command(root, 'git', ['add', '.']);
      command(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'change']);
    },
    run(mode, extra = {}) {
      return spawnSync(process.execPath, [script, mode], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
    },
  };
}

test('unchanged packages do not release', t => {
  const f = fixture(t);
  const r = f.run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).planned, []);
});

test('changed packages release in dependency order with the next patch', t => {
  const f = fixture(t);
  f.change(['react', 'runtime', 'adapters', 'cli']);
  const r = f.run('--publish');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(f.trace, 'utf8').trim().split('\n'), entries.map(([key]) => `${key} 1.2.4 --publish 1`));
});

test('an explicitly increased version is preserved', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'packages/runtime/package.json'), JSON.stringify({ name: '@codexview/runtime', version: '1.4.0' }));
  command(f.root, 'git', ['add', '.']);
  command(f.root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'version']);
  const r = f.run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).planned, [{ key: 'runtime', baseline: 'runtime-v1.2.3', target: '1.4.0' }]);
});

test('an existing target tag stops the plan before publication', t => {
  const f = fixture(t);
  f.change(['adapters']);
  command(f.root, 'git', ['tag', 'adapters-v1.2.4']);
  const r = f.run('--publish');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already exists/);
  assert.throws(() => readFileSync(f.trace));
});

test('a missing published baseline tag stops the plan before publication', t => {
  const f = fixture(t);
  f.change(['adapters']);
  command(f.root, 'git', ['tag', '-d', 'adapters-v1.2.3']);
  const r = f.run('--publish');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /refs\/tags\/adapters-v1\.2\.3/);
  assert.throws(() => readFileSync(f.trace));
});

test('a source version behind the registry fails closed', t => {
  const f = fixture(t);
  const versions = Object.fromEntries(entries.map(([key]) => [`@codexview/${key}`, key === 'adapters' ? '1.2.4' : '1.2.3']));
  const r = f.run('--publish', { TEST_REGISTRY_VERSIONS: JSON.stringify(versions) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /manifest is behind npm latest/);
  assert.throws(() => readFileSync(f.trace));
});

test('a failed package stops later releases', t => {
  const f = fixture(t);
  f.change(['adapters', 'runtime', 'cli', 'react']);
  const r = f.run('--publish', { TEST_FAIL_RELEASE: 'runtime' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(readFileSync(f.trace, 'utf8').trim().split('\n'), ['adapters 1.2.4 --publish 1', 'runtime 1.2.4 --publish 1']);
});

test('publication rejects an unclean checkout and runs only in GitHub Actions', t => {
  const f = fixture(t);
  f.change(['adapters']);
  writeFileSync(join(f.root, 'packages/adapters/src/index.js'), 'dirty\n');
  const dirty = f.run('--publish');
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /clean worktree/);
  const local = f.run('--publish', { GITHUB_ACTIONS: '' });
  assert.notEqual(local.status, 0);
  assert.match(local.stderr, /only in GitHub Actions/);
});
