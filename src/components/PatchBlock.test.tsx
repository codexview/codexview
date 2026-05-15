import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PatchBlock } from './PatchBlock.js';

describe('PatchBlock', () => {
  it('lists files with status tags', () => {
    render(<PatchBlock item={{ id: 'p', kind: 'patch', status: 'completed', startedAt: 0, updatedAt: 0, files: [
      { path: 'a.ts', status: 'modified', diff: '+ new\n- old' },
    ], ok: true }} />);
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('modified')).toBeInTheDocument();
  });
});
