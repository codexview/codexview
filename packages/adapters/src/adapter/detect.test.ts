import { describe, it, expect } from 'vitest';
import { detectFormat, classifyLine, formatHistogram } from './detect.js';

describe('detectFormat', () => {
  it('detects claude-code via sessionId', () => {
    expect(detectFormat([{ type: 'user', sessionId: 's1', message: { content: 'hi' } }])).toBe('claude-code');
  });
  it('detects claude-code even when first line is queue-operation', () => {
    expect(detectFormat([
      { type: 'queue-operation', sessionId: 's1' },
      { type: 'user', sessionId: 's1' },
    ])).toBe('claude-code');
  });
  it('detects rollout via type + payload', () => {
    expect(detectFormat([{ type: 'session_meta', payload: { id: 'x' }, timestamp: '2026' }])).toBe('rollout');
  });
  it('detects codex exec JSONL via documented dotted event names', () => {
    expect(detectFormat([{ type: 'thread.started', thread_id: 'x' }])).toBe('codex-exec');
  });
  it('detects a truncated codex exec JSONL stream', () => {
    expect(detectFormat([{ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'ok' } }])).toBe('codex-exec');
  });
  it('does not steal Claude Code error rows that carry a sessionId', () => {
    expect(detectFormat([{ type: 'error', sessionId: 's1', message: 'boom' }])).toBe('claude-code');
  });
  it('detects codex-team via event + at', () => {
    expect(detectFormat([{ event: 'updated', at: '2026', status: 'running', payload: {} }])).toBe('codex-team');
  });
  it('returns unknown for empty input', () => {
    expect(detectFormat([])).toBe('unknown');
  });
  it('returns unknown for ChatStreamEvent-shaped lines (no payload/sessionId/event)', () => {
    expect(detectFormat([{ type: 'thread_started', threadId: 'T', at: 1 }])).toBe('unknown');
  });
});

describe('detectFormat — github-copilot', () => {
  it('detects a VS Code Copilot chat session JSON object', () => {
    const session = {
      version: 3,
      sessionId: 'abc',
      responderUsername: 'GitHub Copilot',
      responderAvatarIconUri: { id: 'copilot' },
      requests: [],
    };
    expect(detectFormat([session])).toBe('github-copilot');
  });

  it('does not detect non-Copilot v3 JSON (missing responderAvatarIconUri.id)', () => {
    const fake = { version: 3, sessionId: 'x', requests: [] };
    expect(detectFormat([fake])).toBe('unknown');
  });

  it('does not detect a Continue.dev-shaped JSON', () => {
    const continueLike = { version: 3, sessionId: 'y', requests: [], responderUsername: 'Continue' };
    expect(detectFormat([continueLike])).toBe('unknown');
  });
});

describe('classifyLine', () => {
  it('classifies a claude-code line', () => {
    expect(classifyLine({ type: 'user', sessionId: 's1', message: { content: 'hi' } })).toBe('claude-code');
  });
  it('classifies a rollout line', () => {
    expect(classifyLine({ type: 'session_meta', payload: { id: 'x' }, timestamp: '2026' })).toBe('rollout');
  });
  it('classifies a codex exec JSONL line', () => {
    expect(classifyLine({ type: 'turn.completed', usage: {} })).toBe('codex-exec');
  });
  it('classifies a codex-team line', () => {
    expect(classifyLine({ event: 'updated', at: '2026', status: 'running', payload: {} })).toBe('codex-team');
  });
  it('classifies an unrecognized line as unknown', () => {
    expect(classifyLine({ type: 'file-history-snapshot' })).toBe('unknown');
  });
});

describe('formatHistogram', () => {
  it('counts a file that mixes rollout and claude-code lines', () => {
    const hist = formatHistogram([
      { type: 'session_meta', payload: {}, timestamp: 'x' },
      { type: 'event_msg', payload: {}, timestamp: 'x' },
      { type: 'user', sessionId: 's1', message: { content: 'hi' } },
    ]);
    expect(hist).toEqual({ rollout: 2, 'claude-code': 1 });
  });
  it('counts unrecognized lines under unknown without inventing a second known format', () => {
    const hist = formatHistogram([
      { type: 'user', sessionId: 's1' },
      { type: 'assistant', sessionId: 's1' },
      { type: 'file-history-snapshot' },
    ]);
    expect(hist).toEqual({ 'claude-code': 2, unknown: 1 });
  });
});
