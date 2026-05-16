import type { TranscriptModel, TranscriptStatus } from '../types/model.js';

export function inferStatus(model: TranscriptModel): TranscriptStatus {
  const last = model.turns[model.turns.length - 1];
  if (!last) return 'idle';
  switch (last.status) {
    case 'running': return 'working';
    case 'failed': return 'failed';
    case 'aborted': return 'stopped';
    case 'completed': return 'completed';
  }
}
