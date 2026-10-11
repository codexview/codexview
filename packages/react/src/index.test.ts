import { expect, it } from 'vitest';
import { version } from '../package.json';
import { VERSION } from './index.js';

it('reports the public package version', () => {
  expect(VERSION).toBe(version);
});
