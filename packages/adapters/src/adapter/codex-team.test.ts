import { describe, it, expect } from 'vitest';
import { adaptCodexTeam } from './codex-team.js';
import type { RawLine } from '../types.js';

describe('adaptCodexTeam', () => {
  it('emits thread_started, turn_started, agent_messages, turn_completed', () => {
    const out = adaptCodexTeam([
      { at: '2026-01-01T00:00:00Z', event: 'started', status: 'running', payload: { summary: 'kickoff' } },
      { at: '2026-01-01T00:01:00Z', event: 'updated', status: 'running', payload: { summary: 'doing work' } },
      { at: '2026-01-01T00:02:00Z', event: 'finished', status: 'done', payload: { summary: 'done' } },
    ] as RawLine[]);
    const types = out.map((e) => e.type);
    expect(types[0]).toBe('thread_started');
    expect(types[1]).toBe('turn_started');
    expect(types[types.length - 1]).toBe('turn_completed');
  });
  it('emits turn_failed when last status is failed', () => {
    const out = adaptCodexTeam([
      { at: '2026-01-01T00:00:00Z', event: 'started', status: 'running' },
      { at: '2026-01-01T00:01:00Z', event: 'failed', status: 'failed', payload: { summary: 'boom' } },
    ] as RawLine[]);
    expect(out[out.length - 1].type).toBe('turn_failed');
  });
  it('returns [] for empty input', () => {
    expect(adaptCodexTeam([])).toEqual([]);
  });
});
