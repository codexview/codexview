import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '../types/events.js';
import { CodexTranscript } from './CodexTranscript.js';

describe('CodexTranscript', () => {
  const ev: ChatStreamEvent[] = [
    { type: 'thread_started', threadId: 'T', at: 1 },
    { type: 'turn_started', turnId: 'A', at: 2 },
    { type: 'user_message', turnId: 'A', itemId: 'u', text: 'hi', at: 3 },
    { type: 'agent_message', turnId: 'A', itemId: 'a', text: 'hello', partial: false, at: 4 },
    { type: 'turn_completed', turnId: 'A', at: 5 },
  ];

  it('renders empty state when no events', () => {
    render(<CodexTranscript events={[]} />);
    expect(screen.getByText('暂无对话')).toBeInTheDocument();
  });

  it('renders user + assistant messages', () => {
    render(<CodexTranscript events={ev} disableSmoothStream />);
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已完成');
  });

  it('respects maxItems by trimming oldest', () => {
    render(<CodexTranscript events={ev} maxItems={1} disableSmoothStream />);
    expect(screen.getByText(/已省略最早的 1 条/)).toBeInTheDocument();
    expect(screen.queryByText('hi')).toBeNull();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('explicit status prop overrides inference', () => {
    render(<CodexTranscript events={ev} status="stopped" disableSmoothStream />);
    expect(screen.getByRole('status')).toHaveTextContent('已停止');
  });
});
