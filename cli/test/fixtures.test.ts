import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl } from '../src/parse.js';
import { adapt } from '../src/adapter/index.js';
import { render } from '../src/render/markdown.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const readFixture = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

function pipeline(text: string): { format: string; md: string } {
  const lines = parseJsonl(text);
  const { format, events } = adapt(lines);
  return { format, md: render(events) };
}

describe('end-to-end · Claude Code short', () => {
  const { format, md } = pipeline(readFixture('fixtures/claude-code/short.jsonl'));
  it('detects claude-code', () => expect(format).toBe('claude-code'));
  it('starts with # Session', () => expect(md.startsWith('# Session ')).toBe(true));
  it('contains user heading', () => expect(md).toContain('## User'));
  it('contains assistant heading', () => expect(md).toContain('## Assistant'));
  it('renders Bash tool calls as 🔧 lines', () => expect(md).toContain('🔧 `Bash`'));
  it('does not leak Fernet-encrypted reasoning', () => expect(md).not.toContain('gAAAAA'));
});

describe('end-to-end · Claude Code tool-heavy', () => {
  const { md } = pipeline(readFixture('fixtures/claude-code/tool-heavy.jsonl'));
  it('contains Edit or Write tool placeholders', () => {
    expect(md.match(/🔧 `(Edit|Write|MultiEdit)`/)).toBeTruthy();
  });
  it('contains TodoWrite placeholder', () => {
    expect(md).toMatch(/🔧 `TodoWrite` \(\d+ todos\)/);
  });
});

describe('end-to-end · Claude Code thinking-mixed', () => {
  const { md } = pipeline(readFixture('fixtures/claude-code/thinking-mixed.jsonl'));
  it('contains plaintext reasoning blocks', () => {
    expect(md).toContain('## Assistant (reasoning)');
  });
  it('plaintext reasoning is rendered as blockquote', () => {
    expect(md).toMatch(/## Assistant \(reasoning\)\n> /);
  });
});

describe('end-to-end · Claude Code subagent-parent', () => {
  const { md } = pipeline(readFixture('fixtures/claude-code/subagent-parent.jsonl'));
  it('Agent tool renders as single 🔧 line (no embedded summary)', () => {
    expect(md).toContain('🔧 `Agent`');
    expect(md).not.toContain('Tools used:');
    expect(md).not.toContain('Final reply:');
  });
});

describe('end-to-end · hand-written rollout', () => {
  const sample = readFileSync(resolve(here, 'rollout-sample.jsonl'), 'utf8');
  const { format, md } = pipeline(sample);
  it('detects rollout', () => expect(format).toBe('rollout'));
  it('contains user message', () => expect(md).toContain('please run tests'));
  it('contains exec_command_begin as Bash placeholder', () => expect(md).toContain('🔧 `Bash` npm test'));
  it('does not contain stdout', () => expect(md).not.toContain('OK'));
  it('contains assistant text', () => expect(md).toContain('All passing.'));
});
