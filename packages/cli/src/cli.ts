import { readFile, writeFile } from 'node:fs/promises';
import { adapt, parseJsonl, type DetectedFormat, type RawLine } from '@codexview/adapters';
import { render } from './render/markdown.js';

// parseJsonl handles newline-delimited JSON. OpenCode session exports are a
// single JSON document (`opencode export <id>` produces one object). Try
// whole-text parse first — if the input is a valid top-level object/array,
// use it; otherwise fall through to per-line parseJsonl. (Doing parseJsonl
// first would mis-handle pretty-printed multi-line JSON whose internal lines
// occasionally happen to be valid JSON objects on their own — e.g. compact
// inline tool-result objects.)
function parseInput(text: string): RawLine[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as RawLine[];
      if (parsed && typeof parsed === 'object') return [parsed as RawLine];
    } catch { /* not a single JSON document; fall through to jsonl */ }
  }
  return parseJsonl(text);
}

const VERSION = '0.4.0';

const USAGE = `codexview-md — render jsonl agent log to plaintext markdown

USAGE
  codexview-md <input.jsonl>                          # write to stdout
  codexview-md <input.jsonl> -o out.md                # write to file
  codexview-md -                                      # read jsonl from stdin
  codexview-md parent.json --subagent c1.json ...     # OpenCode subagent embed

OPTIONS
  -o, --output <path>   Write to file instead of stdout
  --format <name>       Force input format (rollout | codex-team | claude-code | opencode)
  --subagent <path>     Embed child session export (repeatable; OpenCode only)
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
  subagents: string[];
  help: boolean;
  version: boolean;
}

class ArgError extends Error {}

export function parseArgs(argv: string[]): Args {
  const out: Args = { input: null, output: null, format: null, subagents: [], help: false, version: false };
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
      if (!['rollout', 'codex-team', 'claude-code', 'opencode'].includes(next)) {
        throw new ArgError('--format must be one of: rollout, codex-team, claude-code, opencode');
      }
      out.format = next as DetectedFormat;
    }
    else if (a === '--subagent') {
      const next = argv[++i];
      if (!next) throw new ArgError('--subagent requires a path');
      out.subagents.push(next);
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

  const lines = parseInput(text);

  const subagents: { sessionId: string; lines: RawLine[] }[] = [];
  for (const p of args.subagents) {
    let stext: string;
    try {
      stext = await readFile(p, 'utf8');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`error: failed to read --subagent ${p}: ${msg}\n`);
      process.exit(2);
    }
    const parsed = parseInput(stext);
    const root = parsed.find(
      (l) => l && typeof l === 'object' && (l as Record<string, unknown>).info && typeof ((l as { info: { id?: unknown } }).info?.id) === 'string',
    ) as { info: { id: string } } | undefined;
    if (!root) {
      process.stderr.write(`warning: --subagent ${p} missing info.id, skipping\n`);
      continue;
    }
    subagents.push({ sessionId: root.info.id, lines: parsed });
  }

  const adaptOptions: Parameters<typeof adapt>[1] = { subagents };
  if (args.format) adaptOptions.format = args.format;
  const { format, events } = adapt(lines, adaptOptions);

  if (format === 'unknown') {
    process.stderr.write(`error: could not detect input format (use --format to override)\n`);
    process.exit(1);
  }

  if (format === 'opencode') {
    const matchedIds = new Set(subagents.map((s) => s.sessionId));
    let unmatchedTaskCount = 0;
    for (const root of lines) {
      const msgs = (root as { messages?: unknown[] })?.messages;
      if (!Array.isArray(msgs)) continue;
      for (const m of msgs) {
        const parts = (m as { parts?: unknown[] })?.parts;
        if (!Array.isArray(parts)) continue;
        for (const p of parts) {
          const pp = p as { type?: unknown; tool?: unknown; state?: { metadata?: { sessionId?: unknown } } };
          if (pp.type === 'tool' && pp.tool === 'task') {
            const sid = pp.state?.metadata?.sessionId;
            if (typeof sid === 'string' && !matchedIds.has(sid)) unmatchedTaskCount++;
          }
        }
      }
    }
    if (unmatchedTaskCount > 0) {
      process.stderr.write(
        `note: ${unmatchedTaskCount} subagent task call(s) detected in parent session.\n` +
        `      Re-run with --subagent <child-export.json> per child to embed summaries.\n`,
      );
    }
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
