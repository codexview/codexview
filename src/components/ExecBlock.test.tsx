import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExecBlock } from './ExecBlock.js';

describe('ExecBlock', () => {
  it('renders command and exit status', () => {
    render(<ExecBlock item={{ id: 'e', kind: 'exec', status: 'completed', startedAt: 0, updatedAt: 0, command: 'ls', exit: 0, stdout: 'a', stderr: '', durationMs: 5 }} />);
    expect(screen.getByText('$ ls')).toBeInTheDocument();
    expect(screen.getByText(/exit 0/)).toBeInTheDocument();
  });

  it('shows stderr in red when present', () => {
    render(<ExecBlock item={{ id: 'e', kind: 'exec', status: 'failed', startedAt: 0, updatedAt: 0, command: 'x', exit: 1, stdout: '', stderr: 'no', durationMs: 1 }} />);
    expect(screen.getByText('no')).toBeInTheDocument();
  });
});
