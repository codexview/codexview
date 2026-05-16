import type { RawLine } from './types.js';

export function parseJsonl(text: string): RawLine[] {
  const out: RawLine[] = [];
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') out.push(parsed as RawLine);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}
