import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import { safeStringify } from './_shared.js';
import styles from './RawEventBlock.module.css';

export interface RawEventBlockProps {
  item: Extract<ItemView, { kind: 'raw' }>;
}

export function RawEventBlock({ item }: RawEventBlockProps): JSX.Element {
  const Icon = ICONS.warn;
  const typeLabel = (() => {
    const p = item.payload;
    if (p && typeof p === 'object' && 'type' in p) return String((p as { type: unknown }).type);
    return 'unknown';
  })();
  return (
    <details className={styles.block}>
      <summary className={styles.summary}>
        <Icon size={14} aria-hidden />
        <span>未知事件: {typeLabel}</span>
      </summary>
      <pre className={styles.code}>{safeStringify(item.payload)}</pre>
    </details>
  );
}
