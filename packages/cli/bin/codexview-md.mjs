#!/usr/bin/env node
import { main } from '../dist/cli.js';
main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(String(err?.stack || err) + '\n');
  process.exit(1);
});
