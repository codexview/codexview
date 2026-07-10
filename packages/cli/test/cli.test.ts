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

  it('accepts --format codex-exec', () => {
    const input = [
      JSON.stringify({ type: 'thread.started', thread_id: 'T' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'done' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }),
    ].join('\n');
    const r = spawnSync('node', [bin, '-', '--format', 'codex-exec'], { encoding: 'utf8', input });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('# Session T');
    expect(r.stdout).toContain('## Assistant');
    expect(r.stdout).toContain('done');
  });

  it('exits 1 on unknown format', () => {
    const r = spawnSync('node', [bin, '-'], { encoding: 'utf8', input: '{"type":"thread_started"}\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/could not detect input format/);
  });

  it('renders an opencode export (single-JSON file)', () => {
    const ocFixture = resolve(repoRoot, 'fixtures', 'opencode', 'session-short.json');
    const r = spawnSync('node', [bin, ocFixture], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('# Session ses_fixture_short_001');
    expect(r.stdout).toContain('## User');
    expect(r.stdout).toMatch(/🔧 `Bash`/);
    expect(r.stdout).toMatch(/🔧 `read`/);
  });

  it('exits 3 on bad flag', () => {
    const r = spawnSync('node', [bin, '--nope'], { encoding: 'utf8' });
    expect(r.status).toBe(3);
  });

  it('embeds subagent summaries with --subagent flag', () => {
    const parent = resolve(repoRoot, 'fixtures', 'opencode', 'subagent-parent.json');
    const c1 = resolve(repoRoot, 'fixtures', 'opencode', 'subagent-child-1.json');
    const c2 = resolve(repoRoot, 'fixtures', 'opencode', 'subagent-child-2.json');
    const c3 = resolve(repoRoot, 'fixtures', 'opencode', 'subagent-child-3.json');
    const r = spawnSync('node', [bin, parent, '--subagent', c1, '--subagent', c2, '--subagent', c3], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Screenshot original contact page');
    expect(r.stdout).toContain('agent_type:');
    expect(r.stdout).toContain('ses_fixture_child_001');
    expect(r.stdout).toContain('ses_fixture_child_002');
    expect(r.stdout).toContain('ses_fixture_child_003');
    expect(r.stderr).toBe('');
  });

  it('prints stderr hint when parent has task calls but no --subagent given', () => {
    const parent = resolve(repoRoot, 'fixtures', 'opencode', 'subagent-parent.json');
    const r = spawnSync('node', [bin, parent], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/note: 3 subagent task call\(s\) detected/);
  });

  it('ignores unrelated --subagent files (sessionId not matching any task)', () => {
    const parent = resolve(repoRoot, 'fixtures', 'opencode', 'subagent-parent.json');
    const unrelated = resolve(repoRoot, 'fixtures', 'opencode', 'session-short.json');
    const r = spawnSync('node', [bin, parent, '--subagent', unrelated], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/note: 3 subagent task call\(s\) detected/);
  });

  it('renders a github-copilot fixture to compact markdown', () => {
    const gcFixture = resolve(repoRoot, 'fixtures', 'github-copilot', 'terminal-session.json');
    const r = spawnSync('node', [bin, gcFixture], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('# Session');
    expect(r.stdout).toContain('## User');
    expect(r.stdout).toContain('## Assistant');
  });

  it('accepts --format github-copilot explicitly and flags an empty session', () => {
    const gcFixture = resolve(repoRoot, 'fixtures', 'github-copilot', 'empty-session.json');
    const r = spawnSync('node', [bin, gcFixture, '--format', 'github-copilot'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/no message content/);
  });
});

describe('cli diagnostics', () => {
  const ccText = readFileSync(fixture, 'utf8');
  const rolloutText = readFileSync(resolve(repoRoot, 'packages', 'cli', 'test', 'rollout-sample.jsonl'), 'utf8');

  it('stays silent on stderr for a clean single-format session', () => {
    const r = spawnSync('node', [bin, '-'], { encoding: 'utf8', input: ccText });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('warns about skipped malformed lines but still renders the rest', () => {
    const ccLines = ccText.split('\n').filter(Boolean);
    const corrupted = [ccLines[0], '{ this is not json', ...ccLines.slice(1)].join('\n');
    const r = spawnSync('node', [bin, '-'], { encoding: 'utf8', input: corrupted });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/skipped 1 of/);
    expect(r.stdout).toContain('# Session ');
  });

  it('warns when an input mixes two formats and only one was rendered', () => {
    const mixed = rolloutText.trimEnd() + '\n' + ccText;
    const r = spawnSync('node', [bin, '-'], { encoding: 'utf8', input: mixed });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/mixes 2 formats/);
    expect(r.stderr).toContain('rollout');
    expect(r.stderr).toContain('claude-code');
  });

  it('warns when a recognized format produced no message content', () => {
    const r = spawnSync('node', [bin, '-'], {
      encoding: 'utf8',
      input: '{"type":"summary","sessionId":"abc-123","timestamp":"2026-05-17T00:00:00Z"}\n',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/no message content/);
  });
});
