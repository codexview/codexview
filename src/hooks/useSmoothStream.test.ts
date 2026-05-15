import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSmoothStream } from './useSmoothStream.js';

beforeEach(() => {
  vi.useFakeTimers();
  let raf = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    raf += 1;
    setTimeout(() => cb(performance.now()), 16);
    return raf;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSmoothStream', () => {
  it('returns full text immediately when disabled', () => {
    const { result } = renderHook(() => useSmoothStream('hello', { enabled: false }));
    expect(result.current).toBe('hello');
  });

  it('progressively reveals characters when enabled', async () => {
    const { result } = renderHook(() => useSmoothStream('hello'));
    expect(result.current.length).toBeLessThan(5);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current).toBe('hello');
  });

  it('truncates when input shrinks (reset)', async () => {
    const { result, rerender } = renderHook(({ s }: { s: string }) => useSmoothStream(s), {
      initialProps: { s: 'hello world' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current).toBe('hello world');
    rerender({ s: 'hi' });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(result.current).toBe('hi');
  });
});
