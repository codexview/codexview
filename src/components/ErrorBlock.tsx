import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import styles from './ErrorBlock.module.css';

export interface ErrorBlockProps {
  item: Extract<ItemView, { kind: 'error' }>;
}

export function ErrorBlock({ item }: ErrorBlockProps): JSX.Element {
  const Icon = ICONS.warn;
  return (
    <div className={styles.block} role="alert">
      <Icon size={14} aria-hidden />
      <span className={styles.message}>{item.message}</span>
    </div>
  );
}
