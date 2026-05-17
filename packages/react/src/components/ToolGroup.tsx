import type { ReactNode } from 'react';
import type { ItemView } from '../types/model.js';
import styles from './ToolGroup.module.css';

export interface ToolGroupProps {
  items: ItemView[];
  /** Pre-rendered child blocks, one per item, in the same order as `items`. */
  children: ReactNode;
  /** Default to false (collapsed). Auto-expands while any item is pending/running. */
  defaultOpen?: boolean;
}

const GROUPABLE_KINDS = new Set<ItemView['kind']>([
  'tool_call',
  'exec',
  'search',
  'patch',
  'todo_list',
  'raw',
]);

export function isGroupableKind(kind: ItemView['kind']): boolean {
  return GROUPABLE_KINDS.has(kind);
}

export type Slice =
  | { kind: 'single'; item: ItemView }
  | { kind: 'group'; items: ItemView[] };

export function partitionForGrouping(items: ItemView[]): Slice[] {
  const slices: Slice[] = [];
  let buffer: ItemView[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    slices.push({ kind: 'group', items: buffer });
    buffer = [];
  };
  for (const item of items) {
    if (isGroupableKind(item.kind)) buffer.push(item);
    else {
      flush();
      slices.push({ kind: 'single', item });
    }
  }
  flush();
  return slices;
}

export function summarize(items: ItemView[]): string {
  let exec = 0;
  let patch = 0;
  let toolCall = 0;
  let search = 0;
  let todo = 0;
  let raw = 0;
  for (const it of items) {
    switch (it.kind) {
      case 'exec': exec++; break;
      case 'patch': patch++; break;
      case 'tool_call': toolCall++; break;
      case 'search': search++; break;
      case 'todo_list': todo++; break;
      case 'raw': raw++; break;
    }
  }
  const parts: string[] = [];
  if (todo > 0) parts.push('更新待办');
  if (exec > 0) parts.push(`执行 ${exec} 个命令`);
  if (patch > 0) parts.push(`修改 ${patch} 个文件`);
  if (toolCall > 0) parts.push(`调用 ${toolCall} 个工具`);
  if (search > 0) parts.push(`搜索 ${search} 次`);
  if (raw > 0) parts.push(`${raw} 个事件`);
  return parts.length === 0 ? '工具操作' : parts.join('、');
}

export function ToolGroup({ items, children, defaultOpen = false }: ToolGroupProps): JSX.Element {
  const live = items.some((i) => i.status === 'pending' || i.status === 'running');
  const open = defaultOpen || live;
  return (
    <details className={styles.group} open={open}>
      <summary className={styles.header}>
        <span className={styles.title}>{summarize(items)}</span>
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
