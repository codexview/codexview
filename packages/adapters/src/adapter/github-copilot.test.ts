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
