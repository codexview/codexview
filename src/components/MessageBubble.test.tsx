import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from './MessageBubble.js';

describe('MessageBubble', () => {
  it('renders user message with role=user', () => {
    render(<MessageBubble item={{ id: 'u', kind: 'user_message', status: 'completed', startedAt: 0, updatedAt: 0, text: 'hi' }} />);
    const el = screen.getByText('hi').closest('div')!;
    expect(el.dataset.role).toBe('user');
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
    render(
      <MessageBubble
        smoothStream={false}
        item={{ id: 'a', kind: 'assistant_text', status: 'completed', startedAt: 0, updatedAt: 0, text: 'done' }}
      />,
    );
    expect(screen.queryByText('▋')).toBeNull();
  });
});
