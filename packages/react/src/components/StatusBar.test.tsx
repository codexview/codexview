import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar.js';

describe('StatusBar', () => {
  it('renders nothing when status=idle', () => {
    const { container } = render(<StatusBar status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders working with default label and pulse', () => {
    render(<StatusBar status="working" />);
    expect(screen.getByRole('status')).toHaveTextContent('正在工作');
  });

  it('uses custom label when provided', () => {
    render(<StatusBar status="working" label="思考中" />);
    expect(screen.getByRole('status')).toHaveTextContent('思考中');
  });

  it('renders error details when status=failed', () => {
    render(<StatusBar status="failed" error={{ message: 'oops', details: 'stack' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('oops');
  });
});
