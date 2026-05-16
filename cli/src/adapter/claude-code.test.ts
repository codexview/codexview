import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptClaudeCode } from './claude-code.js';
import type { RawLine } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const readFixture = (rel: string): RawLine[] =>
  readFileSync(resolve(repoRoot, rel), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as RawLine);

describe('adaptClaudeCode', () => {
  it('emits thread_started from sessionId', () => {
    const lines = readFixture('fixtures/claude-code/short.jsonl');
    const out = adaptClaudeCode(lines);
    expect(out[0].type).toBe('thread_started');
    expect((out[0] as { threadId: string }).threadId).toMatch(/^[0-9a-f-]+$/);
  });
  it('emits exec_command_begin for Bash tool_use', () => {
    const lines = readFixture('fixtures/claude-code/short.jsonl');
    const out = adaptClaudeCode(lines);
    expect(out.some((e) => e.type === 'exec_command_begin')).toBe(true);
  });
  it('emits patch_apply_end for Edit tool', () => {
    const lines = readFixture('fixtures/claude-code/tool-heavy.jsonl');
    const out = adaptClaudeCode(lines);
    expect(out.some((e) => e.type === 'patch_apply_end')).toBe(true);
  });
  it('drops empty (encrypted) thinking blocks', () => {
    const lines = readFixture('fixtures/claude-code/thinking-mixed.jsonl');
    const out = adaptClaudeCode(lines);
    const reasoning = out.filter((e) => e.type === 'reasoning');
    for (const r of reasoning) {
      expect((r as { text: string }).text.length).toBeGreaterThan(0);
    }
  });
  it('does NOT embed subagent summary in Agent tool_result', () => {
    const lines = readFixture('fixtures/claude-code/subagent-parent.jsonl');
    const out = adaptClaudeCode(lines);
    const json = JSON.stringify(out);
    expect(json).not.toContain('agent_type:');
    expect(json).not.toContain('Tools used:');
    expect(json).not.toContain('Final reply:');
  });
});
