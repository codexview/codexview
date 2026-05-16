import { readFile, writeFile } from 'node:fs/promises';
import { parseJsonl } from './parse.js';
import { adapt } from './adapter/index.js';
import { render } from './render/markdown.js';
import type { DetectedFormat } from './types.js';

const VERSION = '0.1.0';

const USAGE = `codexview-md — render jsonl agent log to plaintext markdown

USAGE
  codexview-md <input.jsonl>            # write to stdout
  codexview-md <input.jsonl> -o out.md  # write to file
  codexview-md -                        # read jsonl from stdin

OPTIONS
  -o, --output <path>   Write to file instead of stdout
  --format <name>       Force input format (rollout | codex-team | claude-code)
  -h, --help            Show this help
  -v, --version         Show version

EXIT CODES
  0  success
  1  unrecognized format / parse failure
  2  file I/O error
  3  argument error
`;

interface Args {
  input: string | null;
  output: string | null;
  format: DetectedFormat | null;
  help: boolean;
  version: boolean;
}

class ArgError extends Error {}

export function parseArgs(argv: string[]): Args {
  const out: Args = { input: null, output: null, format: null, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-v' || a === '--version') out.version = true;
    else if (a === '-o' || a === '--output') {
      const next = argv[++i];
      if (!next) throw new ArgError('-o requires a path');
      out.output = next;
    }
    else if (a === '--format') {
      const next = argv[++i];
      if (!next) throw new ArgError('--format requires a value');
      if (!['rollout', 'codex-team', 'claude-code'].includes(next)) {
        throw new ArgError('--format must be one of: rollout, codex-team, claude-code');
      }
      out.format = next as DetectedFormat;
    }
    else if (a.startsWith('-') && a !== '-') {
      throw new ArgError(`unknown flag: ${a}`);
    }
    else {
      if (out.input !== null) throw new ArgError('only one input path is supported');
      out.input = a;
    }
  }
  return out;
}

async function readInput(input: string): Promise<string> {
  if (input === '-') return readStdin();
  return readFile(input, 'utf8');
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

export async function main(argv: string[]): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof ArgError) {
      process.stderr.write(`error: ${e.message}\n\n${USAGE}`);
      process.exit(3);
    }
    throw e;
  }

  if (args.help)    { process.stdout.write(USAGE); return; }
  if (args.version) { process.stdout.write(`codexview-md ${VERSION}\n`); return; }
  if (!args.input) {
    process.stderr.write(`error: missing input file (use - for stdin)\n\n${USAGE}`);
    process.exit(3);
  }

  let text: string;
  try {
    text = await readInput(args.input);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: failed to read input: ${msg}\n`);
    process.exit(2);
  }

  const lines = parseJsonl(text);
  const { format, events } = adapt(lines, args.format ?? undefined);

  if (format === 'unknown') {
    process.stderr.write(`error: could not detect input format (use --format to override)\n`);
    process.exit(1);
  }

  const md = render(events);

  if (args.output) {
    try {
      await writeFile(args.output, md, 'utf8');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`error: failed to write output: ${msg}\n`);
      process.exit(2);
    }
  } else {
    process.stdout.write(md);
  }
}
