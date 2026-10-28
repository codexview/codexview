// Builds and installs local tarballs into an isolated consumer. Never publishes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, process.argv[2] ?? `release-artifacts/${new Date().toISOString().replaceAll(':', '-')}`);
const keys = ['adapters', 'runtime', 'cli', 'react'];
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout;
};

mkdirSync(dirname(output), { recursive: true });
mkdirSync(output); // Keep previous verification artifacts intact.
console.log('Building workspace packages...');
run('pnpm', ['build']);
const packages = keys.map(key => {
  const directory = join(root, 'packages', key);
  const manifest = readJson(join(directory, 'package.json'));
  run('pnpm', ['--dir', directory, 'pack', '--pack-destination', output]);
  const filename = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
  const path = join(output, filename);
  const packed = JSON.parse(run('tar', ['-xOf', path, 'package/package.json']));
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  for (const range of Object.values(packed.dependencies ?? {})) {
    assert(!/^(workspace:|file:|link:)/.test(range), `${manifest.name}: unresolved local dependency`);
  }
  const files = run('tar', ['-tzf', path]).trim().split('\n');
  assert(!files.some(file => /(^|\/)(AGENTS\.md|\.env(?:\.[^/]*)?|\.npmrc|node_modules)(\/|$)/.test(file)), `${manifest.name}: private file included`);
  const bytes = readFileSync(path);
  return { name: manifest.name, version: manifest.version, filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});

const consumer = mkdtempSync(join(tmpdir(), 'codexview-package-check-'));
let passed = false;
try {
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'codexview-package-consumer', private: true, type: 'module' }));
  const require = createRequire(join(root, 'packages/react/package.json'));
  const dependencies = ['react', 'react-dom', 'lucide-react', 'jsdom', 'typescript', '@types/node', '@types/react', '@types/react-dom']
    .map(name => `${name}@${readJson(require.resolve(`${name}/package.json`)).version}`);
  console.log('Installing all four tarballs in an isolated consumer...');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...packages.map(pkg => join(output, pkg.filename)), ...dependencies], consumer);
  for (const name of ['package-consumer.mjs', 'package-consumer.mts', 'network-app-server.mjs']) {
    copyFileSync(join(root, 'scripts/fixtures', name), join(consumer, name));
  }
  const checks = JSON.parse(run(process.execPath, ['package-consumer.mjs'], consumer));
  for (const [index, key] of keys.entries()) assert.equal(checks.versions[key], packages[index].version);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--jsx', 'react-jsx', 'package-consumer.mts'], consumer);
  checks.publicTypes = 'passed';
  const report = {
    checkedAt: new Date().toISOString(),
    sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(),
    sourceDirty: run('git', ['status', '--porcelain']).trim().length > 0,
    node: process.version,
    packages,
    checks,
  };
  writeFileSync(join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(output, 'SHA256SUMS'), packages.map(pkg => `${pkg.sha256}  ${pkg.filename}`).join('\n') + '\n');
  passed = true;
  console.log(`Package checks passed. Tarballs, checksums, and verification.json: ${output}`);
} finally {
  if (passed) rmSync(consumer, { recursive: true, force: true });
  else console.error(`Failed consumer retained for inspection: ${consumer}`);
}
