import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatStreamEvent } from '../types/events.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

export function loadFixture(name: string): ChatStreamEvent[] {
  const path = resolve(repoRoot, 'fixtures', `${name}.jsonl`);
  const text = readFileSync(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
}
