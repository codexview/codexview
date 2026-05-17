import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ToolGroup,
  partitionForGrouping,
  summarize,
  isGroupableKind,
} from './ToolGroup.js';
import type { ItemView } from '../types/model.js';

function makeItem(kind: ItemView['kind'], id: string, status: ItemView['status'] = 'completed'): ItemView {
  const base = { id, status, startedAt: 0, updatedAt: 0 };
  switch (kind) {
    case 'user_message':   return { ...base, kind, text: 't' };
    case 'assistant_text': return { ...base, kind, text: 't' };
    case 'reasoning':      return { ...base, kind, text: 't' };
    case 'tool_call':      return { ...base, kind, name: 'Read', args: {} };
    case 'exec':           return { ...base, kind, command: 'ls' };
    case 'search':         return { ...base, kind, query: 'q' };
    case 'patch':          return { ...base, kind, files: [] };
    case 'todo_list':      return { ...base, kind, items: [] };
    case 'error':          return { ...base, kind, message: 'oops' };
    case 'raw':            return { ...base, kind, payload: {} };
  }
}

describe('isGroupableKind', () => {
  it('marks tool-like kinds as groupable', () => {
    expect(isGroupableKind('tool_call')).toBe(true);
    expect(isGroupableKind('exec')).toBe(true);
    expect(isGroupableKind('search')).toBe(true);
    expect(isGroupableKind('patch')).toBe(true);
    expect(isGroupableKind('todo_list')).toBe(true);
    expect(isGroupableKind('raw')).toBe(true);
  });
  it('leaves text/reasoning/error ungrouped', () => {
    expect(isGroupableKind('user_message')).toBe(false);
    expect(isGroupableKind('assistant_text')).toBe(false);
    expect(isGroupableKind('reasoning')).toBe(false);
    expect(isGroupableKind('error')).toBe(false);
  });
});

describe('partitionForGrouping', () => {
  it('returns empty for empty input', () => {
    expect(partitionForGrouping([])).toEqual([]);
  });

  it('groups consecutive tool items, breaking on messages', () => {
    const items: ItemView[] = [
      makeItem('user_message', 'u1'),
      makeItem('exec', 'e1'),
      makeItem('patch', 'p1'),
      makeItem('exec', 'e2'),
      makeItem('assistant_text', 'a1'),
      makeItem('tool_call', 't1'),
    ];
    const slices = partitionForGrouping(items);
    expect(slices.map(s => s.kind)).toEqual(['single', 'group', 'single', 'group']);
    expect((slices[1] as { kind: 'group'; items: ItemView[] }).items.map(i => i.id)).toEqual(['e1', 'p1', 'e2']);
    expect((slices[3] as { kind: 'group'; items: ItemView[] }).items.map(i => i.id)).toEqual(['t1']);
  });

  it('treats reasoning as a break, not part of the group', () => {
    const items: ItemView[] = [
      makeItem('exec', 'e1'),
      makeItem('reasoning', 'r1'),
      makeItem('exec', 'e2'),
    ];
    const slices = partitionForGrouping(items);
    expect(slices.map(s => s.kind)).toEqual(['group', 'single', 'group']);
  });

  it('treats error as a break (keeps errors prominent)', () => {
    const items: ItemView[] = [
      makeItem('exec', 'e1'),
      makeItem('error', 'err1'),
      makeItem('exec', 'e2'),
    ];
    const slices = partitionForGrouping(items);
    expect(slices.map(s => s.kind)).toEqual(['group', 'single', 'group']);
  });
});

describe('summarize', () => {
  it('produces a single-segment label when one kind is present', () => {
    expect(summarize([makeItem('exec', 'e1')])).toBe('执行 1 个命令');
    expect(summarize([makeItem('todo_list', 't1')])).toBe('更新待办');
  });

  it('joins multiple kinds with full-width comma', () => {
    const items: ItemView[] = [
      makeItem('todo_list', 't1'),
      makeItem('exec', 'e1'),
      makeItem('exec', 'e2'),
      makeItem('patch', 'p1'),
    ];
    expect(summarize(items)).toBe('更新待办、执行 2 个命令、修改 1 个文件');
  });

  it('returns a fallback when nothing groupable is provided', () => {
    expect(summarize([])).toBe('工具操作');
  });
});

describe('<ToolGroup />', () => {
  it('renders summary in the closed state and hides children visually', () => {
    render(
      <ToolGroup items={[makeItem('exec', 'e1'), makeItem('patch', 'p1')]}>
        <div>child-block</div>
      </ToolGroup>,
    );
    expect(screen.getByText('执行 1 个命令、修改 1 个文件')).toBeInTheDocument();
    // children are in DOM (still useful for screen readers) but the <details> is closed
    const details = screen.getByText('执行 1 个命令、修改 1 个文件').closest('details');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
  });

  it('auto-opens when an item is running', () => {
    render(
      <ToolGroup items={[makeItem('exec', 'e1', 'running')]}>
        <div>child</div>
      </ToolGroup>,
    );
    const details = screen.getByText(/执行/).closest('details');
    expect(details?.hasAttribute('open')).toBe(true);
  });
});
