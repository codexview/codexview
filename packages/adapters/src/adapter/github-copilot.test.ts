import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adaptGithubCopilot } from './github-copilot';

const FIXTURES = join(__dirname, '../../../../fixtures/github-copilot');
const loadJson = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

describe('adaptGithubCopilot — basics', () => {
  it('emits thread_started + turn boundaries + user/agent messages for empty-session', () => {
    const { events, format } = adaptGithubCopilot(loadJson('empty-session.json'));
    expect(format).toBe('github-copilot');
    expect(events).toEqual([
      expect.objectContaining({ type: 'thread_started', threadId: '00000000-0000-0000-0000-000000000004' }),
    ]);
  });

  it('emits user_message + agent_message + turn boundaries for terminal-session', () => {
    const { events } = adaptGithubCopilot(loadJson('terminal-session.json'));
    const types = events.map((e) => e.type);
    expect(types).toContain('thread_started');
    expect(types).toContain('turn_started');
    expect(types).toContain('user_message');
    expect(types).toContain('agent_message');
    expect(types).toContain('turn_completed');
  });
});

describe('adaptGithubCopilot — terminal tool', () => {
  it('emits exec_command_begin + exec_command_end for run_in_terminal', () => {
    const { events } = adaptGithubCopilot(loadJson('terminal-session.json'));
    const begins = events.filter((e) => e.type === 'exec_command_begin');
    const ends = events.filter((e) => e.type === 'exec_command_end');
    expect(begins.length).toBeGreaterThan(0);
    expect(ends.length).toBe(begins.length);
    const first = begins[0] as any;
    expect(typeof first.command).toBe('string');
    expect(first.command.length).toBeGreaterThan(0);
    const firstEnd = ends[0] as any;
    expect(typeof firstEnd.exit).toBe('number');
    expect(typeof firstEnd.stdout).toBe('string');
  });
});

describe('adaptGithubCopilot — file edit', () => {
  it('emits function_call + function_call_output by default (patchMode=function_call)', () => {
    const { events } = adaptGithubCopilot(loadJson('file-edit-session.json'));
    const fc = events.find((e) => e.type === 'function_call' && (e as any).name === 'insert_edit_into_file');
    const fo = events.find((e) => e.type === 'function_call_output');
    expect(fc).toBeDefined();
    expect(fo).toBeDefined();
  });

  it('emits patch_apply_end when patchMode=patch_apply_end', () => {
    const { events } = adaptGithubCopilot(loadJson('file-edit-session.json'), {
      patchMode: 'patch_apply_end',
    });
    const patch = events.find((e) => e.type === 'patch_apply_end') as any;
    expect(patch).toBeDefined();
    expect(patch.ok).toBe(true);
    expect(patch.files[0].path).toBe('/Users/agent/projects/example/utils.ts');
    expect(patch.files[0].status).toBe('modified');
  });
});

describe('adaptGithubCopilot — mcp + generic fallback', () => {
  it('emits mcp_tool_call + mcp_tool_call_output for MCP tools (source.type=mcp)', () => {
    const { events } = adaptGithubCopilot(loadJson('mcp-session.json'));
    const begin = events.find((e) => e.type === 'mcp_tool_call') as any;
    const end = events.find((e) => e.type === 'mcp_tool_call_output');
    expect(begin).toBeDefined();
    expect(begin.server).toBe('github');
    expect(begin.name).toBe('github__search_code');
    expect(end).toBeDefined();
  });

  it('falls through to function_call for unknown tool ids (no toolSpecificData.kind match)', () => {
    const session = {
      version: 3,
      sessionId: 's',
      creationDate: 0,
      requests: [{
        requestId: 'r', timestamp: 0,
        agent: { extensionId: { value: 'GitHub.copilot-chat' } },
        message: { text: 'x' },
        response: [{
          kind: 'toolInvocationSerialized',
          toolId: 'mystery_tool',
          toolCallId: 'tc',
          isComplete: true,
          invocationMessage: 'Using "Mystery Tool"',
          source: { type: 'internal' },
          toolSpecificData: { kind: 'somethingElse', foo: 'bar' },
        }],
        result: { timings: { totalElapsed: 10 } },
      }],
    };
    const { events } = adaptGithubCopilot(session as any);
    const fc = events.find((e) => e.type === 'function_call') as any;
    expect(fc).toBeDefined();
    expect(fc.name).toBe('mystery_tool');
  });
});

import { adapt } from '../index';

describe('adapt() umbrella — github-copilot', () => {
  it('routes a github-copilot session through the umbrella', () => {
    const result = adapt([loadJson('empty-session.json')]);
    expect(result.format).toBe('github-copilot');
  });
});
