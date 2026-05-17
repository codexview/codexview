import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptOpenCode } from './opencode.js';
import { detectFormat } from './detect.js';
import type { RawLine } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const wrap = (root: Record<string, unknown>): RawLine[] => [root];

const userMsg = (id: string, text: string, ts = 1700000000000) => ({
  info: { id, role: 'user', time: { created: ts } },
  parts: [{ type: 'text', text }],
});

const asstMsg = (id: string, parts: unknown[], ts = 1700000000000, tokens?: Record<string, number>) => ({
  info: {
    id,
    role: 'assistant',
    time: { created: ts, completed: ts + 1000 },
    finish: 'stop',
    ...(tokens ? { tokens } : {}),
  },
  parts,
});

const sessionRoot = (messages: unknown[]) => ({
  info: { id: 'ses_test_001', title: 'test session', time: { created: 1700000000000, updated: 1700000005000 } },
  messages,
});

describe('detectFormat · opencode', () => {
  it("returns 'opencode' for a session export wrapped in a one-element array", () => {
    expect(detectFormat(wrap(sessionRoot([])))).toBe('opencode');
  });

  it("returns 'unknown' for a bare object lacking info.id 'ses_' prefix", () => {
    expect(detectFormat(wrap({ info: { id: 'not-an-opencode-id' }, messages: [] }))).toBe('unknown');
  });
});

describe('adaptOpenCode · happy path', () => {
  it('emits thread_started + turn_started + user_message + agent_message + turn_completed', () => {
    const root = sessionRoot([
      userMsg('msg_u1', 'fix the bug', 1700000000000),
      asstMsg('msg_a1', [{ type: 'text', text: 'sure, looking now' }], 1700000001000, { input: 100, output: 50 }),
    ]);
    const events = adaptOpenCode(wrap(root));
    expect(events.map((e) => e.type)).toEqual([
      'thread_started', 'turn_started', 'user_message', 'agent_message', 'turn_completed',
    ]);
    const usage = (events[4] as { usage?: { inputTokens: number; outputTokens: number } }).usage;
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.outputTokens).toBe(50);
  });

  it('emits reasoning events for assistant reasoning parts', () => {
    const root = sessionRoot([
      userMsg('msg_u1', 'why is the sky blue?'),
      asstMsg('msg_a1', [
        { type: 'reasoning', text: 'rayleigh scattering — the short answer.' },
        { type: 'text', text: 'Because of Rayleigh scattering.' },
      ]),
    ]);
    const events = adaptOpenCode(wrap(root));
    expect(events.some((e) => e.type === 'reasoning' && /rayleigh/i.test(e.text))).toBe(true);
    expect(events.some((e) => e.type === 'agent_message' && /Rayleigh/.test(e.text))).toBe(true);
  });

  it('drops step-start / step-finish / empty-text / empty-reasoning parts', () => {
    const root = sessionRoot([
      userMsg('msg_u1', 'go'),
      asstMsg('msg_a1', [
        { type: 'step-start' },
        { type: 'reasoning', text: '' },
        { type: 'text', text: '' },
        { type: 'text', text: 'ok' },
        { type: 'step-finish' },
      ]),
    ]);
    const events = adaptOpenCode(wrap(root));
    const innerTypes = events.filter((e) => e.type !== 'thread_started' && e.type !== 'turn_started' && e.type !== 'turn_completed' && e.type !== 'user_message').map((e) => e.type);
    expect(innerTypes).toEqual(['agent_message']);
  });
});

describe('adaptOpenCode · bash tool', () => {
  it('maps bash tool to exec_command_begin + exec_command_end', () => {
    const root = sessionRoot([
      userMsg('msg_u1', 'run ls'),
      asstMsg('msg_a1', [{
        type: 'tool', tool: 'bash', callID: 'call_b1',
        state: {
          status: 'completed',
          input: { command: 'ls -la' },
          output: 'total 0\ndrwxr-xr-x  2  staff   64 May 17 17:00 .',
          time: { start: 1700000000000, end: 1700000000150 },
        },
      }]),
    ]);
    const events = adaptOpenCode(wrap(root));
    const begin = events.find((e) => e.type === 'exec_command_begin') as { command: string; callId: string } | undefined;
    const end = events.find((e) => e.type === 'exec_command_end') as { exit: number; stdout: string; durationMs: number } | undefined;
    expect(begin?.command).toBe('ls -la');
    expect(begin?.callId).toBe('call_b1');
    expect(end?.exit).toBe(0);
    expect(end?.stdout).toContain('drwxr-xr-x');
    expect(end?.durationMs).toBe(150);
  });

  it('marks bash tool exit=1 on error status', () => {
    const root = sessionRoot([
      userMsg('msg_u1', 'run bad cmd'),
      asstMsg('msg_a1', [{
        type: 'tool', tool: 'bash', callID: 'call_b1',
        state: { status: 'error', input: { command: 'badcmd' }, output: 'command not found' },
      }]),
    ]);
    const events = adaptOpenCode(wrap(root));
    const end = events.find((e) => e.type === 'exec_command_end') as { exit: number; stderr: string };
    expect(end.exit).toBe(1);
    expect(end.stderr).toBe('command not found');
  });
});

describe('adaptOpenCode · edit / write tool with patchMode', () => {
  const editPart = {
    type: 'tool', tool: 'edit', callID: 'call_e1',
    state: {
      status: 'completed',
      input: { filePath: '/proj/src/app.ts', oldString: 'old code', newString: 'new code' },
      output: 'updated',
    },
  };
  const writePart = {
    type: 'tool', tool: 'write', callID: 'call_w1',
    state: {
      status: 'completed',
      input: { filePath: '/proj/src/new.ts', content: 'export const x = 1;' },
      output: 'written',
    },
  };

  it('default patchMode: edit / write → function_call + function_call_output', () => {
    const root = sessionRoot([userMsg('msg_u1', 'edit'), asstMsg('msg_a1', [editPart, writePart])]);
    const events = adaptOpenCode(wrap(root));
    expect(events.some((e) => e.type === 'function_call' && e.name === 'edit')).toBe(true);
    expect(events.some((e) => e.type === 'function_call' && e.name === 'write')).toBe(true);
    expect(events.some((e) => e.type === 'patch_apply_end')).toBe(false);
  });

  it("patchMode='patch_apply_end': edit → patch_apply_end status='modified' with diff", () => {
    const root = sessionRoot([userMsg('msg_u1', 'edit'), asstMsg('msg_a1', [editPart])]);
    const events = adaptOpenCode(wrap(root), { patchMode: 'patch_apply_end' });
    const pe = events.find((e) => e.type === 'patch_apply_end') as { files: Array<{ path: string; status: string; diff: string }>; ok: boolean };
    expect(pe.files[0]?.path).toBe('/proj/src/app.ts');
    expect(pe.files[0]?.status).toBe('modified');
    expect(pe.files[0]?.diff).toContain('- old code');
    expect(pe.files[0]?.diff).toContain('+ new code');
    expect(pe.ok).toBe(true);
  });

  it("patchMode='patch_apply_end': write → patch_apply_end status='added' with + diff", () => {
    const root = sessionRoot([userMsg('msg_u1', 'write'), asstMsg('msg_a1', [writePart])]);
    const events = adaptOpenCode(wrap(root), { patchMode: 'patch_apply_end' });
    const pe = events.find((e) => e.type === 'patch_apply_end') as { files: Array<{ path: string; status: string; diff: string }> };
    expect(pe.files[0]?.status).toBe('added');
    expect(pe.files[0]?.diff).toContain('+ export const x = 1;');
  });
});

describe('adaptOpenCode · unknown tools', () => {
  it('falls back to function_call + function_call_output for read/glob/grep/...', () => {
    const root = sessionRoot([
      userMsg('msg_u1', 'find files'),
      asstMsg('msg_a1', [
        { type: 'tool', tool: 'glob', callID: 'g1', state: { status: 'completed', input: { pattern: '*.ts' }, output: 'a.ts\nb.ts' } },
        { type: 'tool', tool: 'read', callID: 'r1', state: { status: 'completed', input: { filePath: '/a.ts' }, output: 'file contents' } },
      ]),
    ]);
    const events = adaptOpenCode(wrap(root));
    expect(events.filter((e) => e.type === 'function_call').map((e) => (e as { name: string }).name)).toEqual(['glob', 'read']);
    const outputs = events.filter((e) => e.type === 'function_call_output') as Array<{ output?: string }>;
    expect(outputs.map((o) => o.output)).toEqual(['a.ts\nb.ts', 'file contents']);
  });
});

describe('adaptOpenCode · end-to-end fixture', () => {
  it('parses fixtures/opencode/session-short.json', () => {
    const text = readFileSync(resolve(repoRoot, 'fixtures/opencode/session-short.json'), 'utf8');
    const root = JSON.parse(text);
    const events = adaptOpenCode([root]);
    const typeCounts = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(typeCounts.thread_started).toBe(1);
    expect((typeCounts.turn_started ?? 0)).toBeGreaterThanOrEqual(1);
    expect((typeCounts.user_message ?? 0)).toBeGreaterThanOrEqual(1);
    expect((typeCounts.agent_message ?? 0)).toBeGreaterThanOrEqual(1);
    expect((typeCounts.exec_command_begin ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
