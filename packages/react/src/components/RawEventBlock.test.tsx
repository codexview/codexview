import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RawEventBlock } from './RawEventBlock.js';

describe('RawEventBlock', () => {
  it('shows unknown event with type label and payload preserved', () => {
    render(<RawEventBlock item={{ id: 'r', kind: 'raw', status: 'completed', startedAt: 0, updatedAt: 0, payload: { type: 'foobar', x: 1 } }} />);
    expect(screen.getByText(/未知事件: foobar/)).toBeInTheDocument();
    expect(screen.getByText(/"x": 1/)).toBeInTheDocument();
  });
});

it('recognizes an app-server context compaction item', () => {
  render(<RawEventBlock item={{ id: 'compact', kind: 'raw', status: 'completed', startedAt: 0, updatedAt: 0, payload: { type: 'contextCompaction' } }} />);
  expect(screen.getByText('Context compaction')).toBeInTheDocument();
  expect(screen.queryByText(/未知事件/)).not.toBeInTheDocument();
});
