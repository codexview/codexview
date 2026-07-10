import type { ItemView } from '../types/model.js';
import { useSmoothStream } from '../hooks/useSmoothStream.js';
import { Markdown } from './Markdown.js';
import styles from './MessageBubble.module.css';

export interface MessageBubbleProps {
  item: Extract<ItemView, { kind: 'user_message' | 'assistant_text' }>;
  smoothStream?: boolean;
  /** When true (default), parse text as Markdown. */
  markdown?: boolean;
}

export function MessageBubble({ item, smoothStream = true, markdown = true }: MessageBubbleProps): JSX.Element {
  const isUser = item.kind === 'user_message';
  // User messages are typed by humans as plain text — never render them as
  // Markdown (any *, _, # would be misinterpreted as formatting).
  // Assistant messages: while streaming, keep plain (partial markdown looks
  // janky). Switch to full Markdown once the message is final.
  const useMd = !isUser && markdown && item.status !== 'running';
  const enabled = !isUser && smoothStream && item.status === 'running';
  const text = useSmoothStream(item.text, { enabled });
  return (
    <div
      className={styles.bubble}
      data-role={isUser ? 'user' : 'assistant'}
      data-status={item.status}
      {...(!isUser && item.phase ? { 'data-phase': item.phase } : {})}
    >
      <Markdown asPlain={!useMd}>{text}</Markdown>
      {item.status === 'running' && <span aria-hidden className={styles.caret}>▋</span>}
    </div>
  );
}
