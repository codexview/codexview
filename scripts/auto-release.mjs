// Publish changed packages after the exact main commit has passed CI.
// The canonical release scripts remain responsible for gates, tags and npm verification.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const packages = [
  { key: 'adapters', name: '@codexview/adapters', prefix: 'adapters-v' },
  { key: 'runtime', name: '@codexview/runtime', prefix: 'runtime-v' },
  { key: 'cli', name: '@codexview/cli', prefix: 'cli-v' },
  { key: 'react', name: '@codexview/react', prefix: 'v' },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: 'utf8', env: options.env });
  if (result.error || ![0, ...(options.allowed ?? [])].includes(result.status)) {
    throw new Error(`${command} ${args.join(' ')} failed (status ${result.status ?? 'unknown'})`);
  }
  return { status: result.status, stdout: result.stdout.trim() };
}

function version(value, label) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a plain stable semver version`);
  }
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error(`${label} is outside the supported range`);
  return parts;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function plan(root) {
  const result = [];
  for (const pkg of packages) {
    const dir = `packages/${pkg.key}`;
    const manifest = JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8'));
    if (manifest.name !== pkg.name) throw new Error(`Unexpected package name in ${dir}`);
    const local = version(manifest.version, `${pkg.name} manifest`);
    const latestText = run('npm', ['view', `${pkg.name}@latest`, 'version', '--prefer-online'], { cwd: root }).stdout;
    const latest = version(latestText, `${pkg.name} registry latest`);
    if (compare(local, latest) < 0) throw new Error(`${pkg.name} manifest is behind npm latest`);

    const baseline = `${pkg.prefix}${latestText}`;
    run('git', ['rev-parse', '--verify', `refs/tags/${baseline}`], { cwd: root });
    run('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], { cwd: root });
    const diff = run('git', ['diff', '--quiet', baseline, 'HEAD', '--', dir], { cwd: root, allowed: [1] });
    if (diff.status === 0) continue;

    if (compare(local, latest) === 0 && !Number.isSafeInteger(latest[2] + 1)) throw new Error(`${pkg.name} patch version is outside the supported range`);
    const target = compare(local, latest) > 0 ? manifest.version : `${latest[0]}.${latest[1]}.${latest[2] + 1}`;
    const tag = `${pkg.prefix}${target}`;
    const existing = run('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: root, allowed: [1] });
    if (existing.status === 0) throw new Error(`${tag} already exists; inspect its workflow and registry status before retrying`);
    result.push({ ...pkg, baseline, target, tag });
  }
  return result;
}

function main() {
  const mode = process.argv[2];
  if (!['--dry-run', '--publish'].includes(mode) || process.argv.length !== 3) {
    throw new Error('Usage: node scripts/auto-release.mjs --dry-run|--publish');
  }
  const root = run('git', ['rev-parse', '--show-toplevel']).stdout;
  if (mode === '--publish') {
    if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Automatic publication runs only in GitHub Actions');
    if (run('git', ['branch', '--show-current'], { cwd: root }).stdout !== 'main') throw new Error('Automatic publication requires main');
    if (run('git', ['status', '--porcelain'], { cwd: root }).stdout) throw new Error('Automatic publication requires a clean worktree');
  }
  const releases = plan(root);
  console.log(JSON.stringify({ planned: releases.map(({ key, baseline, target }) => ({ key, baseline, target })) }));
  if (mode === '--dry-run') return;
  for (const release of releases) {
    console.log(`Releasing ${release.name}@${release.target}`);
    const result = spawnSync(resolve(root, 'packages', release.key, 'release.sh'), [release.target, '--publish'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, CODEXVIEW_DISPATCH_RELEASE_WORKFLOW: '1' },
    });
    if (result.error || result.status !== 0) throw new Error(`Release failed for ${release.name}; inspect its tag, workflow and registry before retrying`);
  }
}

try { main(); }
catch (error) { console.error(`auto-release: ${error.message}`); process.exitCode = 1; }
