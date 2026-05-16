import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import { safeStringify } from './_shared.js';
import { Markdown } from './Markdown.js';
import styles from './ToolCallBlock.module.css';

export interface ToolCallBlockProps {
  item: Extract<ItemView, { kind: 'tool_call' }>;
  /** Whether the block is open by default. Defaults to false (collapsed). */
  defaultOpen?: boolean;
}

function phrase(name: string, server?: string): string {
  return server ? `${server}.${name}` : name;
}

/**
 * If a value is a plain string, render as Markdown. Otherwise pretty-print as
 * JSON in a code block. This matches how most coding agents emit tool results:
 * either prose/Markdown or structured JSON.
 */
function ResultBody({ value }: { value: unknown }): JSX.Element {
  if (typeof value === 'string') return <Markdown>{value}</Markdown>;
  return <pre className={styles.code}>{safeStringify(value)}</pre>;
}

export function ToolCallBlock({ item, defaultOpen = false }: ToolCallBlockProps): JSX.Element {
  const Icon = ICONS.tool;
  // Auto-open while pending/running so the user can watch progress.
  const open = defaultOpen || item.status === 'pending' || item.status === 'running';
  return (
    <details className={styles.block} data-status={item.status} open={open}>
      <summary className={styles.header}>
        <Icon size={14} aria-hidden />
        <span className={styles.title}>{phrase(item.name, item.server)}</span>
        <span className={styles.statusChip}>{item.status}</span>
      </summary>
      <div className={styles.body}>
        <div className={styles.args}>
          <div className={styles.label}>args</div>
          <pre className={styles.code}>{safeStringify(item.args)}</pre>
        </div>
        {item.error !== undefined && <div className={styles.error}>{item.error}</div>}
        {item.result !== undefined && (
          <div className={styles.result}>
            <div className={styles.label}>result</div>
            <ResultBody value={item.result} />
          </div>
        )}
      </div>
    </details>
  );
}
