import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolCallBlock } from './ToolCallBlock.js';

describe('ToolCallBlock', () => {
  it('renders pending tool call without result', () => {
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'pending', startedAt: 0, updatedAt: 0, name: 'getWeather', args: { city: 'NYC' } }} />);
    expect(screen.getByText('getWeather')).toBeInTheDocument();
    expect(screen.queryByText('result')).toBeNull();
  });

  it('renders inline result when small', () => {
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'completed', startedAt: 0, updatedAt: 0, name: 'x', args: {}, result: { ok: true } }} />);
    expect(screen.getByText('result')).toBeInTheDocument();
  });

  it('renders collapsed result when large', () => {
    const big = 'x'.repeat(600);
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'completed', startedAt: 0, updatedAt: 0, name: 'x', args: {}, result: big }} />);
    const details = screen.getByText('result').closest('details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
  });

  it('renders error in failed state', () => {
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'failed', startedAt: 0, updatedAt: 0, name: 'x', args: {}, error: 'boom' }} />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('prefixes name with server for MCP tools', () => {
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'pending', startedAt: 0, updatedAt: 0, name: 'list', server: 'fs', args: {} }} />);
    expect(screen.getByText('fs.list')).toBeInTheDocument();
  });
});
