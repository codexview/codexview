import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatStreamEvent } from '../types/events.js';

export function loadFixture(name: string): ChatStreamEvent[] {
  const path = resolve(process.cwd(), 'fixtures', `${name}.jsonl`);
  const text = readFileSync(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
}
