import { describe, expect, it } from 'vitest';
import type { TranscriptModel, TurnView } from '../types/model.js';
import { EMPTY_MODEL } from '../types/model.js';
import { inferStatus } from './status.js';

function modelWithLastTurn(status: TurnView['status']): TranscriptModel {
  return {
    ...EMPTY_MODEL,
    turns: [{ turnId: 'X', startedAt: 0, status, items: [] }],
    lastEventAt: 1,
  };
}

describe('inferStatus', () => {
  it('returns idle when no turns', () => {
    expect(inferStatus(EMPTY_MODEL)).toBe('idle');
  });
  it('returns working when last turn running', () => {
    expect(inferStatus(modelWithLastTurn('running'))).toBe('working');
  });
  it('returns failed when last turn failed', () => {
    expect(inferStatus(modelWithLastTurn('failed'))).toBe('failed');
  });
  it('returns stopped when last turn aborted', () => {
    expect(inferStatus(modelWithLastTurn('aborted'))).toBe('stopped');
  });
  it('returns completed when last turn completed', () => {
    expect(inferStatus(modelWithLastTurn('completed'))).toBe('completed');
  });
});
