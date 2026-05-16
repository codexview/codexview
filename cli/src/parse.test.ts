import { describe, it, expect } from 'vitest';
import { parseJsonl } from './parse.js';

describe('parseJsonl', () => {
  it('parses one object per line', () => {
    const out = parseJsonl('{"a":1}\n{"b":2}\n');
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('ignores blank lines', () => {
    expect(parseJsonl('\n\n{"a":1}\n\n')).toEqual([{ a: 1 }]);
  });
  it('skips malformed lines', () => {
    expect(parseJsonl('{"a":1}\nnot json\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('returns [] for empty input', () => {
    expect(parseJsonl('')).toEqual([]);
  });
});
