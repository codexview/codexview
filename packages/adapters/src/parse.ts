import type { RawLine } from './types.js';

export interface ParseStats {
  /** Non-blank lines seen. */
  total: number;
  /** Lines that parsed into a JSON object (== returned lines length). */
  parsed: number;
  /** Non-blank lines that did not yield a JSON object (bad JSON or non-object). */
  malformed: number;
}

export function parseJsonlWithStats(text: string): { lines: RawLine[]; stats: ParseStats } {
  const lines: RawLine[] = [];
  let total = 0;
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    total++;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') lines.push(parsed as RawLine);
    } catch {
      /* malformed — counted below */
    }
  }
  return { lines, stats: { total, parsed: lines.length, malformed: total - lines.length } };
}

export function parseJsonl(text: string): RawLine[] {
  return parseJsonlWithStats(text).lines;
}
