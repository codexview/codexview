import type { ItemView } from '../types/model.js';
import { useSmoothStream } from '../hooks/useSmoothStream.js';
import { ICONS } from './icons.js';
import styles from './ReasoningBlock.module.css';

export interface ReasoningBlockProps {
  item: Extract<ItemView, { kind: 'reasoning' }>;
  defaultOpen?: boolean;
  smoothStream?: boolean;
}

function durationLabel(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ReasoningBlock({ item, defaultOpen = false, smoothStream = true }: ReasoningBlockProps): JSX.Element {
  const Icon = ICONS.reasoning;
  const live = item.status === 'running';
  const text = useSmoothStream(item.text, { enabled: smoothStream && live });
  const elapsed = item.updatedAt - item.startedAt;
  return (
    <details className={styles.block} open={defaultOpen || live}>
      <summary className={styles.summary}>
        <Icon size={14} aria-hidden />
        <span>{live ? '思考中…' : `思考 (${durationLabel(elapsed)})`}</span>
      </summary>
      <div className={styles.body}>{text}</div>
    </details>
  );
}
