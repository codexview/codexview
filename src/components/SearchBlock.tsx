import { useState } from 'react';
import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import styles from './SearchBlock.module.css';

export interface SearchBlockProps {
  item: Extract<ItemView, { kind: 'search' }>;
  initialVisible?: number;
}

export function SearchBlock({ item, initialVisible = 3 }: SearchBlockProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const Icon = ICONS.search;
  const results = item.results ?? [];
  const visible = showAll ? results : results.slice(0, initialVisible);
  const remaining = results.length - visible.length;
  return (
    <div className={styles.block} data-status={item.status}>
      <header className={styles.header}>
        <Icon size={14} aria-hidden />
        <span className={styles.query}>{item.query}</span>
      </header>
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
        <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
          展开剩余 {remaining} 条
        </button>
      )}
    </div>
  );
}
