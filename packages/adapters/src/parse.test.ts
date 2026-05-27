import { describe, it, expect } from 'vitest';
import { parseJsonl, parseJsonlWithStats } from './parse.js';

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

describe('parseJsonlWithStats', () => {
  it('reports total, parsed, and malformed line counts', () => {
    const r = parseJsonlWithStats('{"a":1}\nnot json\n{"b":2}');
    expect(r.lines).toEqual([{ a: 1 }, { b: 2 }]);
    expect(r.stats).toEqual({ total: 3, parsed: 2, malformed: 1 });
  });
  it('does not count blank lines toward total or malformed', () => {
    const r = parseJsonlWithStats('\n\n{"a":1}\n\n');
    expect(r.stats).toEqual({ total: 1, parsed: 1, malformed: 0 });
  });
  it('counts valid JSON that is not an object as malformed', () => {
    const r = parseJsonlWithStats('{"a":1}\n123\n"str"');
    expect(r.lines).toEqual([{ a: 1 }]);
    expect(r.stats).toEqual({ total: 3, parsed: 1, malformed: 2 });
  });
  it('reports all zeros for empty input', () => {
    const r = parseJsonlWithStats('');
    expect(r.lines).toEqual([]);
    expect(r.stats).toEqual({ total: 0, parsed: 0, malformed: 0 });
  });
});
