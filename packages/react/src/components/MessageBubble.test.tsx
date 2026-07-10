import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from './MessageBubble.js';

const bubbleCss = readFileSync(resolve('src/components/MessageBubble.module.css'), 'utf8');
const tokenCss = readFileSync(resolve('src/styles/tokens.css'), 'utf8');

describe('MessageBubble', () => {
  it('exposes a configurable max-width token with a full-width default', () => {
    expect(tokenCss).toContain('--cv-message-max-width: 100%');
    expect(bubbleCss).toContain('max-width: var(--cv-message-max-width)');
  });

  it('renders user message with role=user', () => {
    const { container } = render(
      <MessageBubble item={{ id: 'u', kind: 'user_message', status: 'completed', startedAt: 0, updatedAt: 0, text: 'hi' }} />,
    );
    expect(screen.getByText('hi')).toBeInTheDocument();
    const bubble = container.querySelector('[data-role]') as HTMLElement;
    expect(bubble.dataset.role).toBe('user');
  });

  it('renders running assistant with caret', () => {
    render(
      <MessageBubble
        smoothStream={false}
        item={{ id: 'a', kind: 'assistant_text', status: 'running', startedAt: 0, updatedAt: 0, text: 'partial' }}
      />,
    );
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.getByText('▋')).toBeInTheDocument();
  });

  it('completed assistant has no caret', () => {
    const { container } = render(
      <MessageBubble
        smoothStream={false}
        item={{ id: 'a', kind: 'assistant_text', status: 'completed', startedAt: 0, updatedAt: 0, text: 'done', phase: 'final_answer' }}
      />,
    );
    expect(screen.queryByText('▋')).toBeNull();
    expect((container.querySelector('[data-role]') as HTMLElement).dataset.phase).toBe('final_answer');
  });
});
