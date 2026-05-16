import { useEffect, useRef, useState } from 'react';

export interface UseSmoothStreamOptions {
  enabled?: boolean;
  /** When > 0, override automatic chars-per-frame calculation. */
  charsPerFrame?: number;
  minDelayMs?: number;
}

const HAS_SEGMENTER = typeof Intl !== 'undefined' && typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter === 'function';

function segments(text: string): string[] {
  if (!HAS_SEGMENTER) return Array.from(text);
  const seg = new (Intl as unknown as { Segmenter: new (locale?: string, opts?: { granularity: 'grapheme' }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter(undefined, { granularity: 'grapheme' });
  const out: string[] = [];
  for (const part of seg.segment(text)) out.push(part.segment);
  return out;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSmoothStream(fullText: string, options: UseSmoothStreamOptions = {}): string {
  const { enabled = true, charsPerFrame, minDelayMs = 16 } = options;
  const [shown, setShown] = useState<string>(() => (!enabled || reducedMotion() ? fullText : ''));
  const targetRef = useRef<string[]>(segments(fullText));
  const idxRef = useRef<number>((!enabled || reducedMotion()) ? targetRef.current.length : 0);
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || reducedMotion()) {
      setShown(fullText);
      targetRef.current = segments(fullText);
      idxRef.current = targetRef.current.length;
      return;
    }
    const newSegs = segments(fullText);
    const oldSegs = targetRef.current;
    targetRef.current = newSegs;
    const isPrefix = newSegs.length >= oldSegs.length && oldSegs.every((s, i) => s === newSegs[i]);
    if (!isPrefix) {
      // text shrunk or replaced — reset
      idxRef.current = 0;
      setShown('');
    } else if (idxRef.current > newSegs.length) {
      idxRef.current = newSegs.length;
    }

    const tick = (_t: number) => {
      const target = targetRef.current;
      const remaining = target.length - idxRef.current;
      if (remaining <= 0) { rafRef.current = null; return; }
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      if (elapsed < minDelayMs) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastTickRef.current = now;
      const step = Math.max(1, charsPerFrame ?? Math.ceil(remaining / 8));
      idxRef.current = Math.min(target.length, idxRef.current + step);
      setShown(target.slice(0, idxRef.current).join(''));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [fullText, enabled, charsPerFrame, minDelayMs]);

  return shown;
}
