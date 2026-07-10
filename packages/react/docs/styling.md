# Styling

CodexView ships its own styles (`codexview/styles.css`) plus a `.codexview-root` reset to isolate from host CSS. All visual tokens are CSS variables you can override.

## Loading

```ts
import 'codexview/styles.css';
```

## Variable reference

Set these on `.codexview-root` (or any ancestor) to theme.

### Layout

| Variable | Default | Notes |
|----------|---------|-------|
| `--cv-font-family` | system-ui stack | |
| `--cv-font-mono` | ui-monospace stack | |
| `--cv-font-size` | `14px` | base text size |
| `--cv-line-height` | `1.55` | |
| `--cv-radius` | `12px` | bubble radius |
| `--cv-radius-sm` | `8px` | block radius |
| `--cv-message-max-width` | `80%` | maximum user/assistant message width |
| `--cv-spacing-xs/-sm/-md/-lg` | 4/8/12/16 px | spacing scale |

### Colors

Defaults are the "warm paper" light palette (since 0.2.1): ivory page, deep ink-brown text, peach user-bubble accent, warm-ink code blocks. Override any of these to retheme.

| Variable | Default (light) | Notes |
|----------|-----------------|-------|
| `--cv-text` | `#3a342c` | primary text (deep ink brown) |
| `--cv-text-muted` | `#8a7e6b` | reasoning, captions (warm taupe) |
| `--cv-text-inverse` | `#faf6ef` | text on dark surfaces |
| `--cv-bg` | `#faf6ef` | transcript background (ivory) |
| `--cv-bg-raised` | `#f1eadb` | StatusBar, expanded tool block surface |
| `--cv-bg-user-bubble` | `#e8c5b3` | user bubble (peach; text uses `--cv-text`) |
| `--cv-bg-assistant-bubble` | `#f1eadb` | assistant bubble |
| `--cv-bg-code` | `#2c2620` | exec / code background (warm ink) |
| `--cv-fg-code` | `#ede4d3` | code foreground (cream) |
| `--cv-border` | `#d9ceb6` | dividers (warm hairline) |
| `--cv-axis-color` | `#d9ceb6` | turn timeline axis |
| `--cv-shimmer-color` | `rgba(58,52,44,0.08)` | exec shimmer (warm tint) |

### Status colors

| Variable | Default | Status |
|----------|---------|--------|
| `--cv-status-pending` | `#8a7e6b` | warm taupe |
| `--cv-status-running` | `#5b7c99` | muted slate-blue |
| `--cv-status-completed` | `#6b8e4e` | sage olive |
| `--cv-status-failed` | `#b04a3a` | vermillion |
| `--cv-status-stopped` | `#8a7e6b` | warm taupe |

### Diff colors

| Variable | Default |
|----------|---------|
| `--cv-diff-add-bg` | `#e6ecd5` (pale moss) |
| `--cv-diff-del-bg` | `#f3dcd0` (pale rose) |

## Restoring the pre-0.2.1 cool palette

Drop these overrides if you preferred the original GitHub-style cool palette:

```css
.codexview-root {
  --cv-text: #1f2328;
  --cv-text-muted: #6e7781;
  --cv-text-inverse: #ffffff;
  --cv-bg: #ffffff;
  --cv-bg-raised: #f6f8fa;
  --cv-bg-user-bubble: #2f6feb;
  --cv-bg-assistant-bubble: #f6f8fa;
  --cv-bg-code: #0d1117;
  --cv-fg-code: #e6edf3;
  --cv-border: #d0d7de;
  --cv-axis-color: #d0d7de;
  --cv-shimmer-color: rgba(31,35,40,0.08);
  --cv-status-running: #2f6feb;
  --cv-status-completed: #1a7f37;
  --cv-status-failed: #cf222e;
  --cv-diff-add-bg: #ddf4e4;
  --cv-diff-del-bg: #ffebe9;
}
```

You'll also want to override `MessageBubble`'s user-bubble color back to `var(--cv-text-inverse)` via a component swap or a more targeted style, since 0.2.2 switched user-bubble text to `--cv-text`.

## Dark theme example

```css
.dark .codexview-root {
  --cv-text: #e6edf3;
  --cv-text-muted: #8b949e;
  --cv-bg: #0d1117;
  --cv-bg-raised: #161b22;
  --cv-bg-assistant-bubble: #161b22;
  --cv-bg-user-bubble: #1f6feb;
  --cv-border: #30363d;
  --cv-axis-color: #30363d;
  --cv-shimmer-color: rgba(255,255,255,0.05);
  --cv-bg-code: #010409;
  --cv-fg-code: #c9d1d9;
}
```

## Reduced motion

All animations (pulse, shimmer, blink caret, smooth stream) honor `prefers-reduced-motion: reduce` and degrade to static states automatically.
