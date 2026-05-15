import type { ItemView } from '../types/model.js';
import { useSmoothStream } from '../hooks/useSmoothStream.js';
import styles from './MessageBubble.module.css';

export interface MessageBubbleProps {
  item: Extract<ItemView, { kind: 'user_message' | 'assistant_text' }>;
  smoothStream?: boolean;
}

export function MessageBubble({ item, smoothStream = true }: MessageBubbleProps): JSX.Element {
  const isUser = item.kind === 'user_message';
  const enabled = !isUser && smoothStream && item.status === 'running';
  const text = useSmoothStream(item.text, { enabled });
  return (
    <div
      className={styles.bubble}
      data-role={isUser ? 'user' : 'assistant'}
      data-status={item.status}
    >
      <span className={styles.text}>{text}</span>
      {item.status === 'running' && <span aria-hidden className={styles.caret}>▋</span>}
    </div>
  );
}
