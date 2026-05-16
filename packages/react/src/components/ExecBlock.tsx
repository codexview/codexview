import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import styles from './ExecBlock.module.css';

export interface ExecBlockProps {
  item: Extract<ItemView, { kind: 'exec' }>;
  /** Open by default? Defaults to false (collapsed). */
  defaultOpen?: boolean;
}

export function ExecBlock({ item, defaultOpen = false }: ExecBlockProps): JSX.Element {
  const Icon = ICONS.exec;
  const running = item.status === 'running';
  // Auto-open while running so the user can watch output stream in.
  const open = defaultOpen || running;
  const exitText = item.exit != null ? `(exit ${item.exit}, ${item.durationMs ?? '?'}ms)` : '';
  return (
    <details className={styles.block} data-status={item.status} open={open}>
      <summary className={styles.header}>
        <Icon size={14} aria-hidden />
        <code className={styles.cmd}>$ {item.command}</code>
        <span className={styles.exit}>{exitText}</span>
      </summary>
      <div className={styles.body}>
        {running && <div className={styles.shimmer} aria-hidden />}
        {item.stdout && <pre className={styles.stdout}>{item.stdout}</pre>}
        {item.stderr && <pre className={styles.stderr}>{item.stderr}</pre>}
      </div>
    </details>
  );
}
