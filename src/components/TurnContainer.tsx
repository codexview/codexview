import type { ReactNode } from 'react';
import type { TurnView } from '../types/model.js';
import styles from './TurnContainer.module.css';

export interface TurnContainerProps {
  turn: TurnView;
  children: ReactNode;
}

export function TurnContainer({ turn, children }: TurnContainerProps): JSX.Element {
  return (
    <section className={styles.turn} data-turn-id={turn.turnId} data-turn-status={turn.status}>
      <div className={styles.axis}>{children}</div>
    </section>
  );
}
