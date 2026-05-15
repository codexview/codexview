const MAX_INLINE_CHARS = 500;
const MAX_INLINE_LINES = 4;
const MAX_DEPTH = 3;

function depth(value: unknown, current = 0): number {
  if (value == null || typeof value !== 'object' || current > MAX_DEPTH) return current;
  let max = current;
  for (const v of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, depth(v, current + 1));
  }
  return max;
}

export function shouldCollapseValue(value: unknown): boolean {
  if (typeof value === 'string') {
    if (value.length > MAX_INLINE_CHARS) return true;
    if (value.split('\n').length > MAX_INLINE_LINES) return true;
    return false;
  }
  try {
    const json = JSON.stringify(value, null, 2);
    if (json == null) return false;
    if (json.length > MAX_INLINE_CHARS) return true;
    if (json.split('\n').length > MAX_INLINE_LINES) return true;
    if (depth(value) > MAX_DEPTH) return true;
    return false;
  } catch {
    return true;
  }
}

export function safeStringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return '[unserializable]'; }
}
