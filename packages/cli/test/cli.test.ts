import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const bin = resolve(here, '..', 'bin', 'codexview-md.mjs');
const fixture = resolve(repoRoot, 'fixtures', 'claude-code', 'short.jsonl');

describe('cli smoke', () => {
  beforeAll(() => {
    const build = spawnSync('pnpm', ['build'], { cwd: resolve(here, '..'), encoding: 'utf8' });
    if (build.status !== 0) throw new Error('build failed: ' + build.stderr);
  });

  it('prints help on -h', () => {
    const r = spawnSync('node', [bin, '-h'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('USAGE');
  });

  it('prints version on -v', () => {
    const r = spawnSync('node', [bin, '-v'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/codexview-md \d/);
  });

  it('renders fixture to stdout', () => {
    const r = spawnSync('node', [bin, fixture], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('# Session ');
    expect(r.stdout).toContain('## User');
  });

  it('writes to file with -o', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codexview-cli-'));
    const out = join(dir, 'out.md');
    const r = spawnSync('node', [bin, fixture, '-o', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('# Session ');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads from stdin with -', () => {
    const text = readFileSync(fixture, 'utf8');
    const r = spawnSync('node', [bin, '-'], { encoding: 'utf8', input: text });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('# Session ');
  });

  it('exits 1 on unknown format', () => {
    const r = spawnSync('node', [bin, '-'], { encoding: 'utf8', input: '{"type":"thread_started"}\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/could not detect input format/);
  });

  it('exits 3 on bad flag', () => {
    const r = spawnSync('node', [bin, '--nope'], { encoding: 'utf8' });
    expect(r.status).toBe(3);
  });
});
