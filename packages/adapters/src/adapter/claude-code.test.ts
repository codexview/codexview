import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptClaudeCode, type SubagentInput } from './claude-code.js';
import type { RawLine } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const readFixture = (rel: string): RawLine[] =>
  readFileSync(resolve(repoRoot, rel), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as RawLine);

const readMeta = (rel: string): SubagentInput['meta'] =>
  JSON.parse(readFileSync(resolve(repoRoot, rel), 'utf8'));

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
  it('emits function_call for Edit / Write / MultiEdit (no patch_apply_end)', () => {
    const lines = readFixture('fixtures/claude-code/tool-heavy.jsonl');
    const out = adaptClaudeCode(lines);
    expect(out.some((e) => e.type === 'function_call' && /^(Edit|Write|MultiEdit)$/.test(e.name))).toBe(true);
    expect(out.some((e) => e.type === 'patch_apply_end')).toBe(false);
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

describe('adaptClaudeCode · patchMode option', () => {
  it("default ('function_call') emits Edit/Write/MultiEdit as opaque function_call", () => {
    const lines = readFixture('fixtures/claude-code/tool-heavy.jsonl');
    const out = adaptClaudeCode(lines);
    expect(out.some((e) => e.type === 'patch_apply_end')).toBe(false);
    expect(out.some((e) => e.type === 'function_call' && /^(Edit|Write|MultiEdit)$/.test(e.name))).toBe(true);
  });

  it("'patch_apply_end' emits patch_apply_end with diff for Edit/Write/MultiEdit", () => {
    const lines = readFixture('fixtures/claude-code/tool-heavy.jsonl');
    const out = adaptClaudeCode(lines, { patchMode: 'patch_apply_end' });
    const patchEnds = out.filter((e) => e.type === 'patch_apply_end');
    expect(patchEnds.length).toBeGreaterThan(0);
    for (const evt of patchEnds) {
      const pe = evt as { files: Array<{ path: string; diff?: string; status: string }>; ok: boolean };
      expect(pe.files.length).toBe(1);
      expect(typeof pe.files[0]?.path).toBe('string');
      expect(typeof pe.files[0]?.diff).toBe('string');
      expect(['added', 'modified', 'deleted']).toContain(pe.files[0]?.status);
    }
    // none of those names should appear as bare function_call any more
    expect(out.some((e) => e.type === 'function_call' && /^(Edit|Write|MultiEdit)$/.test(e.name))).toBe(false);
  });
});

describe('adaptClaudeCode · subagents option', () => {
  const parentLines = (): RawLine[] => readFixture('fixtures/claude-code/subagent-parent.jsonl');
  const subagent = (): SubagentInput => ({
    agentId: 'test-agent-id',
    meta: readMeta('fixtures/claude-code/subagent-child.meta.json'),
    lines: readFixture('fixtures/claude-code/subagent-child.jsonl'),
  });

  it('matches subagent by toolUseResult.agentId and embeds Markdown summary', () => {
    const out = adaptClaudeCode(parentLines(), { subagents: [subagent()] });
    const agentOutput = out.find(
      (e) => e.type === 'function_call_output' && typeof (e as { output?: unknown }).output === 'string',
    ) as { output: string } | undefined;
    expect(agentOutput).toBeTruthy();
    expect(agentOutput!.output).toContain('agent_type:');
    expect(agentOutput!.output).toContain('test-agent-id');
    expect(agentOutput!.output).toContain('DeepSeek V4 capabilities research');
  });

  it('falls back to FIFO when agentId is not present in the supplied list', () => {
    const sub = subagent();
    const out = adaptClaudeCode(parentLines(), {
      subagents: [{ ...sub, agentId: 'mismatched-id' }],
    });
    const agentOutput = out.find(
      (e) => e.type === 'function_call_output' && typeof (e as { output?: unknown }).output === 'string',
    ) as { output: string } | undefined;
    expect(agentOutput).toBeTruthy();
    expect(agentOutput!.output).toContain('mismatched-id');
    expect(agentOutput!.output).toContain('DeepSeek V4 capabilities research');
  });

  it('empty list preserves default behavior (no embedding)', () => {
    const out = adaptClaudeCode(parentLines(), { subagents: [] });
    const json = JSON.stringify(out);
    expect(json).not.toContain('agent_type:');
    expect(json).not.toContain('Tools used:');
  });
});

describe('adaptClaudeCode · WebSearch', () => {
  const minimalWebSearchLines = (resultText: string, isError = false): RawLine[] => [
    {
      type: 'user',
      uuid: 'u1',
      sessionId: 's-ws',
      timestamp: '2026-05-17T00:00:00Z',
      message: { role: 'user', content: 'search for X' },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      sessionId: 's-ws',
      timestamp: '2026-05-17T00:00:01Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_WS1', name: 'WebSearch', input: { query: 'react 19 migration' } },
        ],
      },
    },
    {
      type: 'user',
      uuid: 'u2',
      sessionId: 's-ws',
      timestamp: '2026-05-17T00:00:02Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_WS1', is_error: isError, content: resultText },
        ],
      },
    },
  ];

  it('emits web_search_call with the query', () => {
    const out = adaptClaudeCode(minimalWebSearchLines('Links: []'));
    const call = out.find((e) => e.type === 'web_search_call');
    expect(call).toBeTruthy();
    expect((call as { query: string }).query).toBe('react 19 migration');
    expect((call as { callId: string }).callId).toBe('toolu_WS1');
  });

  it('parses Links: [...] from tool_result into web_search_end results', () => {
    const result = 'Web search results for query: "react 19 migration"\n\nLinks: [{"title":"Migrating to React 19","url":"https://react.example/migration"},{"title":"React 19 release notes","url":"https://react.example/blog/19"}]\n\nSome summary text.';
    const out = adaptClaudeCode(minimalWebSearchLines(result));
    const end = out.find((e) => e.type === 'web_search_end') as { results: Array<{ title: string; url: string }> } | undefined;
    expect(end).toBeTruthy();
    expect(end!.results.length).toBe(2);
    expect(end!.results[0]?.title).toBe('Migrating to React 19');
    expect(end!.results[0]?.url).toBe('https://react.example/migration');
    expect(out.some((e) => e.type === 'function_call_output')).toBe(false);
  });

  it('emits web_search_end with empty results when Links: []', () => {
    const out = adaptClaudeCode(minimalWebSearchLines('Links: []'));
    const end = out.find((e) => e.type === 'web_search_end') as { results: unknown[] } | undefined;
    expect(end).toBeTruthy();
    expect(end!.results.length).toBe(0);
  });

  it('falls back to function_call_output when Links: is malformed JSON', () => {
    const out = adaptClaudeCode(minimalWebSearchLines('Links: [not json'));
    expect(out.some((e) => e.type === 'web_search_end')).toBe(false);
    expect(out.some((e) => e.type === 'function_call_output')).toBe(true);
  });

  it('falls back to function_call_output when tool_result is an error', () => {
    const out = adaptClaudeCode(minimalWebSearchLines('rate limited', /* isError */ true));
    expect(out.some((e) => e.type === 'web_search_end')).toBe(false);
    const errOut = out.find((e) => e.type === 'function_call_output') as { error?: string } | undefined;
    expect(errOut?.error).toBe('rate limited');
  });

  it('end-to-end: parses fixtures/claude-code/websearch.jsonl', () => {
    const lines = readFixture('fixtures/claude-code/websearch.jsonl');
    const out = adaptClaudeCode(lines);
    const call = out.find((e) => e.type === 'web_search_call') as { query: string; callId: string } | undefined;
    expect(call?.query).toBe('react 19 migration guide');
    expect(call?.callId).toBe('toolu_WS_FIXTURE_1');
    const end = out.find((e) => e.type === 'web_search_end') as { results: Array<{ title: string; url: string }> } | undefined;
    expect(end?.results.length).toBe(3);
    expect(end?.results[0]?.url).toBe('https://react.example/blog/19-upgrade-guide');
    expect(out.some((e) => e.type === 'function_call_output')).toBe(false);
  });
});
