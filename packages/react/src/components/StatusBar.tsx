import type { TranscriptStatus } from '../types/model.js';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  status: TranscriptStatus;
  label?: string;
  error?: { message: string; details?: string };
}

const LABELS: Record<TranscriptStatus, string> = {
  idle: '',
  working: '正在工作',
  completed: '已完成',
  stopped: '已停止',
  failed: '出错',
};

export function StatusBar({ status, label, error }: StatusBarProps): JSX.Element | null {
  if (status === 'idle') return null;
  const text = label ?? LABELS[status];
  return (
    <div className={styles.bar} data-status={status} role="status" aria-live="polite">
      {status === 'working' && <span aria-hidden className={styles.pulse} />}
      <span className={styles.label}>{text}</span>
      {error && (
        <details className={styles.errorDetails}>
          <summary>{error.message}</summary>
          {error.details && <pre>{error.details}</pre>}
        </details>
      )}
    </div>
  );
}
