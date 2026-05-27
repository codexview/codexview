import { describe, it, expect } from 'vitest';
import { diagnose } from './diagnose.js';
import type { ChatStreamEvent, RawLine } from '../types.js';

const userMsg: ChatStreamEvent = {
  type: 'user_message', turnId: 't', itemId: 'i', text: 'hi', at: 0,
};
const threadStart: ChatStreamEvent = { type: 'thread_started', threadId: 'T', at: 0 };

const ccLine = (i: number): RawLine => ({ type: 'user', sessionId: 's1', uuid: `u${i}` });
const rolloutLine = (): RawLine => ({ type: 'session_meta', payload: {}, timestamp: 'x' });

describe('diagnose', () => {
  it('returns no diagnostics for a clean single-format session with content', () => {
    const diags = diagnose({
      parseStats: { total: 2, parsed: 2, malformed: 0 },
      lines: [ccLine(1), ccLine(2)],
      format: 'claude-code',
      events: [threadStart, userMsg],
    });
    expect(diags).toEqual([]);
  });

  it('warns when malformed lines were skipped', () => {
    const diags = diagnose({
      parseStats: { total: 3, parsed: 2, malformed: 1 },
      lines: [ccLine(1), ccLine(2)],
      format: 'claude-code',
      events: [threadStart, userMsg],
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('malformed-lines');
    expect(diags[0].level).toBe('warning');
    expect(diags[0].message).toContain('1');
    expect(diags[0].message).toContain('3');
  });

  it('warns when the input mixes two known formats and only one was rendered', () => {
    const diags = diagnose({
      parseStats: { total: 4, parsed: 4, malformed: 0 },
      lines: [rolloutLine(), rolloutLine(), ccLine(1), ccLine(2)],
      format: 'rollout',
      events: [threadStart, userMsg],
    });
    const mixed = diags.find((d) => d.code === 'mixed-format');
    expect(mixed).toBeDefined();
    expect(mixed!.level).toBe('warning');
    expect(mixed!.message).toContain('rollout');
    expect(mixed!.message).toContain('claude-code');
  });

  it('does not flag mixed-format for a single stray cross-classified line', () => {
    const diags = diagnose({
      parseStats: { total: 4, parsed: 4, malformed: 0 },
      lines: [ccLine(1), ccLine(2), ccLine(3), rolloutLine()],
      format: 'claude-code',
      events: [threadStart, userMsg],
    });
    expect(diags.find((d) => d.code === 'mixed-format')).toBeUndefined();
  });

  it('warns when a recognized format produced no message content', () => {
    const diags = diagnose({
      parseStats: { total: 1, parsed: 1, malformed: 0 },
      lines: [ccLine(1)],
      format: 'claude-code',
      events: [threadStart],
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('empty-result');
    expect(diags[0].level).toBe('warning');
  });

  it('reports empty-input info when nothing parsed, and nothing else', () => {
    const diags = diagnose({
      parseStats: { total: 0, parsed: 0, malformed: 0 },
      lines: [],
      format: 'unknown',
      events: [],
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('empty-input');
    expect(diags[0].level).toBe('info');
  });
});
