import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchBlock } from './SearchBlock.js';

describe('SearchBlock', () => {
  it('shows query and limited results', () => {
    render(<SearchBlock item={{ id: 's', kind: 'search', status: 'completed', startedAt: 0, updatedAt: 0, query: 'ts', results: [
      { title: 'A', url: 'https://a' },
      { title: 'B', url: 'https://b' },
      { title: 'C', url: 'https://c' },
      { title: 'D', url: 'https://d' },
    ] }} />);
    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('D')).toBeNull();
    expect(screen.getByText(/展开剩余 1 条/)).toBeInTheDocument();
  });

  it('expands all on click', () => {
    render(<SearchBlock item={{ id: 's', kind: 'search', status: 'completed', startedAt: 0, updatedAt: 0, query: 'q', results: [
      { title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }, { title: 'C', url: 'https://c' }, { title: 'D', url: 'https://d' },
    ] }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it.each(['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'not a URL'])('keeps an unsafe result URL inert: %s', url => {
    render(<SearchBlock defaultOpen item={{ id: 's', kind: 'search', status: 'completed', startedAt: 0, updatedAt: 0, query: 'q', results: [
      { title: 'Untrusted result', url, snippet: 'Still readable' },
      { title: 'Safe result', url: 'https://example.com/result' },
    ] }} />);
    expect(screen.getByText('Untrusted result')).toBeInTheDocument();
    expect(screen.getByText('Still readable')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Untrusted result' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Safe result' })).toHaveAttribute('href', 'https://example.com/result');
  });
});
