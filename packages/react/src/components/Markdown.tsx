import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Markdown.module.css';

export interface MarkdownProps {
  /** Plain text or Markdown source. Treated as Markdown by default. */
  children: string;
  /** Skip parsing — render as plain pre-wrapped text. */
  asPlain?: boolean;
  className?: string;
}

/**
 * Lightweight Markdown renderer wired with GFM (tables, strikethrough, task
 * lists, autolinks). Code blocks render with monospace + dark background.
 * Intentionally bare: no syntax highlighting (keeps the bundle small) and no
 * raw HTML allowed (XSS-safe by default).
 *
 * Inline `::action{params}` directives (a Codex Web/IDE convention emitted by
 * the model after successful side-effects) are extracted out of the Markdown
 * stream and rendered as compact badges.
 */
function MarkdownInner({ children, asPlain, className }: MarkdownProps): JSX.Element {
  const segments = useMemo(() => (asPlain ? null : splitDirectives(children)), [children, asPlain]);

  if (asPlain) {
    return <span className={[styles.plain, className].filter(Boolean).join(' ')}>{children}</span>;
  }

  if (!segments || segments.length === 1 && segments[0]!.kind === 'md') {
    return (
      <div className={[styles.md, className].filter(Boolean).join(' ')}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className={[styles.md, className].filter(Boolean).join(' ')}>
      {segments!.map((seg, i) => (
        seg.kind === 'md'
          ? <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
          : <DirectiveBadge key={i} name={seg.name} params={seg.params} />
      ))}
    </div>
  );
}

export const Markdown = memo(MarkdownInner);

// --- Directive parsing ------------------------------------------------------

interface DirectiveSegment {
  kind: 'directive';
  name: string;
  params: Record<string, string | boolean>;
}
interface MarkdownSegment {
  kind: 'md';
  text: string;
}
type Segment = DirectiveSegment | MarkdownSegment;

// Matches an entire line that consists of `::name{ key="value" key2=true ... }`.
// Anchored to start-of-line / end-of-line; tolerates leading whitespace.
const DIRECTIVE_LINE_RE = /^[ \t]*::([a-z][a-z0-9-]*)\{([^}\n]*)\}[ \t]*$/gm;

function splitDirectives(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const m of text.matchAll(DIRECTIVE_LINE_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (start > lastIndex) {
      segments.push({ kind: 'md', text: text.slice(lastIndex, start) });
    }
    segments.push({ kind: 'directive', name: m[1]!, params: parseParams(m[2]!) });
    lastIndex = end;
    // Eat a single trailing newline so the directive doesn't leave a blank
    // paragraph behind.
    if (text[lastIndex] === '\n') lastIndex += 1;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'md', text: text.slice(lastIndex) });
  }
  return segments.length === 0 ? [{ kind: 'md', text }] : segments;
}

// Parse `cwd="/x/y" branch="master" isDraft=true` → { cwd, branch, isDraft }
function parseParams(src: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_-]*)=(?:"([^"]*)"|(true|false))/g;
  for (const m of src.matchAll(re)) {
    const key = m[1]!;
    if (m[2] !== undefined) out[key] = m[2];
    else out[key] = m[3] === 'true';
  }
  return out;
}

// --- Badge ------------------------------------------------------------------

const KNOWN: Record<string, { icon: string; label: (p: Record<string, string | boolean>) => string }> = {
  'git-stage':         { icon: '✓', label: () => 'Staged' },
  'git-commit':        { icon: '✓', label: () => 'Committed' },
  'git-push':          { icon: '↑', label: (p) => `Pushed${p.branch ? ` → ${p.branch}` : ''}` },
  'git-create-branch': { icon: '⎇', label: (p) => `Branch ${p.branch ?? 'created'}` },
  'git-create-pr':     { icon: '→', label: (p) => `PR opened${p.branch ? ` (${p.branch})` : ''}${p.isDraft ? ' · draft' : ''}` },
  'archive':           { icon: '⊙', label: () => 'Archived' },
  'code-comment':      { icon: '✎', label: () => 'Code comment' },
};

function DirectiveBadge({ name, params }: { name: string; params: Record<string, string | boolean> }): JSX.Element {
  const spec = KNOWN[name];
  const icon = spec?.icon ?? '·';
  const label = spec ? spec.label(params) : name;
  const href = typeof params.url === 'string' ? params.url : null;
  const cwd = typeof params.cwd === 'string' ? params.cwd.split('/').pop() : null;

  const inner = (
    <>
      <span className={styles.directiveIcon}>{icon}</span>
      <span className={styles.directiveLabel}>{label}</span>
      {cwd && <span className={styles.directiveCwd}>{cwd}</span>}
    </>
  );

  return href
    ? <a className={styles.directive} href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
    : <span className={styles.directive}>{inner}</span>;
}
