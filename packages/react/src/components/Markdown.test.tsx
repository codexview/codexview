import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown.js';

describe('Markdown directives', () => {
  it('renders a pull request link', () => {
    render(<Markdown>{'::git-create-pr{url="https://github.com/example/repo/pull/1"}'}</Markdown>);
    expect(screen.getByRole('link', { name: /PR opened/ })).toHaveAttribute('href', 'https://github.com/example/repo/pull/1');
  });

  it.each(['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd'])('keeps an unsafe directive URL inert: %s', url => {
    render(<Markdown>{`::git-create-pr{url="${url}"}`}</Markdown>);
    expect(screen.getByText('PR opened')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders an unknown directive named after an Object property', () => {
    render(<Markdown>{'::constructor{}'}</Markdown>);
    expect(screen.getByText('constructor')).toBeInTheDocument();
  });
});
