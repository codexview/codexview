import type { ItemView } from '../types/model.js';
import styles from './TodoListBlock.module.css';

export interface TodoListBlockProps {
  item: Extract<ItemView, { kind: 'todo_list' }>;
  /** Initial open/collapsed state. Defaults to collapsed. */
  defaultOpen?: boolean;
}

export function TodoListBlock({ item, defaultOpen = false }: TodoListBlockProps): JSX.Element {
  const total = item.items.length;
  const done = item.items.filter((e) => e.completed).length;
  const summary = total === 0 ? '计划' : `计划 (${done}/${total})`;
  return (
    <details className={styles.block} data-status={item.status} open={defaultOpen || item.status === 'running'}>
      <summary className={styles.summary}>
        <span className={styles.icon} aria-hidden>📋</span>
        <span>{summary}</span>
      </summary>
      <ul className={styles.list}>
        {item.items.map((entry, i) => (
          <li key={i} className={styles.entry} data-completed={entry.completed}>
            <span className={styles.check} aria-hidden>{entry.completed ? '☑' : '☐'}</span>
            <span className={styles.text}>{entry.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
