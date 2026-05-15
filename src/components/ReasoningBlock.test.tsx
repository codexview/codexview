import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReasoningBlock } from './ReasoningBlock.js';

describe('ReasoningBlock', () => {
  it('shows thinking-in-progress label and is open while running', () => {
    render(
      <ReasoningBlock smoothStream={false} item={{ id: 'r', kind: 'reasoning', status: 'running', startedAt: 0, updatedAt: 100, text: 'hmm' }} />,
    );
    expect(screen.getByText(/思考中/)).toBeInTheDocument();
    expect(screen.getByText('hmm')).toBeInTheDocument();
  });

  it('shows duration when completed and is collapsed by default', () => {
    render(
      <ReasoningBlock smoothStream={false} item={{ id: 'r', kind: 'reasoning', status: 'completed', startedAt: 0, updatedAt: 1500, text: 'done' }} />,
    );
    expect(screen.getByText(/思考 \(1\.5s\)/)).toBeInTheDocument();
    const details = screen.getByText(/思考/).closest('details')!;
    expect(details.open).toBe(false);
  });
});
