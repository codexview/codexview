import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import styles from './PatchBlock.module.css';

export interface PatchBlockProps {
  item: Extract<ItemView, { kind: 'patch' }>;
}

function colorLines(diff: string): JSX.Element[] {
  return diff.split('\n').map((line, i) => {
    let cls = '';
    if (line.startsWith('+') && !line.startsWith('+++')) cls = styles.add!;
    else if (line.startsWith('-') && !line.startsWith('---')) cls = styles.del!;
    return <span key={i} className={cls}>{line}{'\n'}</span>;
  });
}

export function PatchBlock({ item }: PatchBlockProps): JSX.Element {
  const Icon = ICONS.patch;
  return (
    <div className={styles.block} data-status={item.status}>
      <header className={styles.header}>
        <Icon size={14} aria-hidden />
        <span>{item.files.length} 个文件 ({item.ok ? '成功' : '失败'})</span>
      </header>
      <ul className={styles.files}>
        {item.files.map((f) => (
          <li key={f.path}>
            <details>
              <summary>
                <code>{f.path}</code>
                <span className={styles.tag} data-kind={f.status}>{f.status}</span>
              </summary>
              {f.diff && <pre className={styles.diff}>{colorLines(f.diff)}</pre>}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
