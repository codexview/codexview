import { describe, it, expect } from 'vitest';
import { detectFormat } from './detect.js';

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
