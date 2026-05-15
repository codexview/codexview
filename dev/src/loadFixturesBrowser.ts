import type { ChatStreamEvent } from '../../src/types/events.js';

const modules = import.meta.glob('../../fixtures/*.jsonl', { as: 'raw', eager: true });

export interface FixtureEntry { name: string; events: ChatStreamEvent[] }

export const FIXTURES: FixtureEntry[] = Object.entries(modules)
  .map(([path, raw]) => {
    const name = path.split('/').pop()!.replace('.jsonl', '');
    const events = (raw as string)
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as ChatStreamEvent);
    return { name, events };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
