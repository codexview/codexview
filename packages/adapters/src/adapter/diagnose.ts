import type { ChatStreamEvent, DetectedFormat, Diagnostic, RawLine } from '../types.js';
import type { ParseStats } from '../parse.js';
import { formatHistogram } from './detect.js';

export interface DiagnoseInput {
  parseStats?: ParseStats;
  lines: RawLine[];
  format: DetectedFormat;
  events: ChatStreamEvent[];
}

/** Events that carry no conversation content on their own. */
const STRUCTURAL: ReadonlySet<ChatStreamEvent['type']> = new Set([
  'thread_started',
  'turn_started',
  'turn_completed',
]);

/** A dropped format counts as real (not a stray misclassification) at >= 2 lines. */
const MIXED_MIN_LINES = 2;

export function diagnose(input: DiagnoseInput): Diagnostic[] {
  const { parseStats, lines, format, events } = input;
  const diags: Diagnostic[] = [];

  if (parseStats && parseStats.total === 0) {
    diags.push({ level: 'info', code: 'empty-input', message: 'input contained no JSON lines' });
    return diags;
  }

  if (parseStats && parseStats.malformed > 0) {
    diags.push({
      level: 'warning',
      code: 'malformed-lines',
      message: `skipped ${parseStats.malformed} of ${parseStats.total} line(s) that were not valid JSON objects`,
    });
  }

  if (format !== 'unknown') {
    const hist = formatHistogram(lines);
    const known = (Object.entries(hist) as [DetectedFormat, number][])
      .filter(([fmt]) => fmt !== 'unknown')
      .sort((a, b) => b[1] - a[1]);
    const droppedReal = known.some(([fmt, n]) => fmt !== format && n >= MIXED_MIN_LINES);
    if (known.length > 1 && droppedReal) {
      const summary = known.map(([fmt, n]) => `${fmt}: ${n}`).join(', ');
      diags.push({
        level: 'warning',
        code: 'mixed-format',
        message: `input mixes ${known.length} formats (${summary}); only "${format}" was rendered, other lines were dropped`,
      });
    }
  }

  if (format !== 'unknown' && !events.some((e) => !STRUCTURAL.has(e.type))) {
    diags.push({
      level: 'warning',
      code: 'empty-result',
      message: `format "${format}" was detected but produced no message content`,
    });
  }

  return diags;
}
