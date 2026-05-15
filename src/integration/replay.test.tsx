import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodexTranscript } from '../components/CodexTranscript.js';
import { loadFixture } from './loadFixture.js';

const FIXTURES = ['short-chat', 'tool-heavy', 'mcp-flow', 'failed-turn', 'aborted-turn', 'unknown-types'];

describe('replay integration', () => {
  for (const name of FIXTURES) {
    it(`renders ${name} without throwing`, () => {
      const events = loadFixture(name);
      expect(() => render(<CodexTranscript events={events} disableSmoothStream />)).not.toThrow();
    });
  }

  it('short-chat shows both user and assistant text', () => {
    const events = loadFixture('short-chat');
    const { getByText } = render(<CodexTranscript events={events} disableSmoothStream />);
    expect(getByText('Hello, who are you?')).toBeInTheDocument();
    expect(getByText("I'm Codex, your coding assistant.")).toBeInTheDocument();
  });

  it('failed-turn StatusBar shows failed', () => {
    const events = loadFixture('failed-turn');
    const { getByRole } = render(<CodexTranscript events={events} disableSmoothStream />);
    expect(getByRole('status').getAttribute('data-status')).toBe('failed');
  });

  it('aborted-turn StatusBar shows stopped', () => {
    const events = loadFixture('aborted-turn');
    const { getByRole } = render(<CodexTranscript events={events} disableSmoothStream />);
    expect(getByRole('status').getAttribute('data-status')).toBe('stopped');
  });

  it('unknown-types renders RawEventBlock for unknown event', () => {
    const events = loadFixture('unknown-types');
    const { container } = render(<CodexTranscript events={events} disableSmoothStream />);
    expect(container.textContent).toMatch(/未知事件/);
  });
});
