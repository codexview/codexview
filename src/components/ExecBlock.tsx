import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import { shouldCollapseValue } from './_shared.js';
import styles from './ExecBlock.module.css';

export interface ExecBlockProps {
  item: Extract<ItemView, { kind: 'exec' }>;
}

export function ExecBlock({ item }: ExecBlockProps): JSX.Element {
  const Icon = ICONS.exec;
  const running = item.status === 'running';
  const exitText = item.exit != null ? `(exit ${item.exit}, ${item.durationMs ?? '?'}ms)` : '';
  const stdoutCollapse = shouldCollapseValue(item.stdout ?? '');
  const stderrCollapse = shouldCollapseValue(item.stderr ?? '');
  return (
    <div className={styles.block} data-status={item.status}>
      <header className={styles.header}>
        <Icon size={14} aria-hidden />
        <code className={styles.cmd}>$ {item.command}</code>
        <span className={styles.exit}>{exitText}</span>
      </header>
      {running && <div className={styles.shimmer} aria-hidden />}
      {item.stdout && (
        stdoutCollapse ? (
          <details><summary>stdout</summary><pre className={styles.stdout}>{item.stdout}</pre></details>
        ) : <pre className={styles.stdout}>{item.stdout}</pre>
      )}
      {item.stderr && (
        stderrCollapse ? (
          <details><summary>stderr</summary><pre className={styles.stderr}>{item.stderr}</pre></details>
        ) : <pre className={styles.stderr}>{item.stderr}</pre>
      )}
    </div>
  );
}
