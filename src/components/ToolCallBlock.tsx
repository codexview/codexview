import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import { safeStringify, shouldCollapseValue } from './_shared.js';
import styles from './ToolCallBlock.module.css';

export interface ToolCallBlockProps {
  item: Extract<ItemView, { kind: 'tool_call' }>;
}

function phrase(name: string, server?: string): string {
  return server ? `${server}.${name}` : name;
}

export function ToolCallBlock({ item }: ToolCallBlockProps): JSX.Element {
  const Icon = ICONS.tool;
  return (
    <div className={styles.block} data-status={item.status}>
      <header className={styles.header}>
        <Icon size={14} aria-hidden />
        <span className={styles.title}>{phrase(item.name, item.server)}</span>
        <span className={styles.statusChip}>{item.status}</span>
      </header>
      <div className={styles.args}>
        <div className={styles.label}>args</div>
        <pre className={styles.code}>{safeStringify(item.args)}</pre>
      </div>
      {item.error !== undefined && (
        <div className={styles.error}>{item.error}</div>
      )}
      {item.result !== undefined && (
        shouldCollapseValue(item.result) ? (
          <details className={styles.result}>
            <summary>result</summary>
            <pre className={styles.code}>{safeStringify(item.result)}</pre>
          </details>
        ) : (
          <div className={styles.result}>
            <div className={styles.label}>result</div>
            <pre className={styles.code}>{safeStringify(item.result)}</pre>
          </div>
        )
      )}
    </div>
  );
}
