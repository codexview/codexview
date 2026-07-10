import type { DetectedFormat, RawLine } from '../types.js';

/** Classify a single line independently. detectFormat returns the first non-unknown. */
export function classifyLine(line: RawLine): DetectedFormat {
  if (!line || typeof line !== 'object') return 'unknown';
  const first = line as Record<string, unknown>;

  // Stable machine-readable stream emitted by `codex exec --json`.
  // Detect any documented top-level event so truncated streams that do not
  // begin with thread.started are still recognized.
  const type = first.type;
  if (
    typeof type === 'string' &&
    (type === 'thread.started' ||
      type === 'turn.started' ||
      type === 'turn.completed' ||
      type === 'turn.failed' ||
      type === 'item.started' ||
      type === 'item.updated' ||
      type === 'item.completed' ||
      (type === 'error' && typeof first.message === 'string' && !('sessionId' in first) && !('payload' in first)))
  ) {
    return 'codex-exec';
  }

  // OpenCode: single-JSON export wrapped in a one-element array.
  // Top level has { info: { id: 'ses_...' }, messages: [...] }.
  const info = first.info;
  if (
    info && typeof info === 'object' &&
    Array.isArray(first.messages) &&
    typeof (info as Record<string, unknown>).id === 'string' &&
    ((info as Record<string, unknown>).id as string).startsWith('ses_')
  ) {
    return 'opencode';
  }
  // GitHub Copilot: single-JSON export with version=3 and copilot avatar id.
  // Must be checked before the claude-code branch because Copilot exports
  // also carry a top-level `sessionId` field.
  if (
    first.version === 3 &&
    (first.responderAvatarIconUri as Record<string, unknown> | undefined)?.id === 'copilot' &&
    Array.isArray(first.requests)
  ) {
    return 'github-copilot';
  }
  // claude-code JSONL lines have sessionId but are NOT v3+requests-shaped
  // (that shape belongs to other tools like Copilot or Continue).
  if ('sessionId' in first && !(first.version === 3 && Array.isArray(first.requests))) {
    return 'claude-code';
  }
  if ('type' in first && ('payload' in first || 'timestamp' in first)) return 'rollout';
  if ('event' in first && 'at' in first) return 'codex-team';
  return 'unknown';
}

export function detectFormat(lines: RawLine[]): DetectedFormat {
  for (const line of lines) {
    const fmt = classifyLine(line);
    if (fmt !== 'unknown') return fmt;
  }
  return 'unknown';
}

/** Per-format line counts (including `unknown`). Used to flag mixed-format inputs. */
export function formatHistogram(lines: RawLine[]): Partial<Record<DetectedFormat, number>> {
  const hist: Partial<Record<DetectedFormat, number>> = {};
  for (const line of lines) {
    const fmt = classifyLine(line);
    hist[fmt] = (hist[fmt] ?? 0) + 1;
  }
  return hist;
}
