import { useState } from 'react';
import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import styles from './SearchBlock.module.css';

export interface SearchBlockProps {
  item: Extract<ItemView, { kind: 'search' }>;
  initialVisible?: number;
  /** Open by default? Defaults to false (collapsed). */
  defaultOpen?: boolean;
}

export function SearchBlock({ item, initialVisible = 3, defaultOpen = false }: SearchBlockProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const Icon = ICONS.search;
  const results = item.results ?? [];
  const visible = showAll ? results : results.slice(0, initialVisible);
  const remaining = results.length - visible.length;
  // Auto-open while pending so the user sees the in-flight query.
  const open = defaultOpen || item.status === 'pending' || item.status === 'running';
  return (
    <details className={styles.block} data-status={item.status} open={open}>
      <summary className={styles.header}>
        <Icon size={14} aria-hidden />
        <span className={styles.query}>{item.query}</span>
      </summary>
      <div className={styles.body}>
        {results.length > 0 && (
          <ol className={styles.results}>
            {visible.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                {r.snippet && <p className={styles.snippet}>{r.snippet}</p>}
              </li>
            ))}
          </ol>
        )}
        {remaining > 0 && (
          <button type="button" className={styles.more} onClick={(e) => { e.preventDefault(); setShowAll(true); }}>
            展开剩余 {remaining} 条
          </button>
        )}
      </div>
    </details>
  );
}
