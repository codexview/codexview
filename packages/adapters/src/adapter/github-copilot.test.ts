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
