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
| `--cv-spacing-xs/-sm/-md/-lg` | 4/8/12/16 px | spacing scale |

### Colors

| Variable | Default (light) | Notes |
|----------|-----------------|-------|
| `--cv-text` | `#1f2328` | primary text |
| `--cv-text-muted` | `#6e7781` | reasoning, captions |
| `--cv-text-inverse` | `#ffffff` | text on user bubble |
| `--cv-bg` | `#ffffff` | transcript background |
| `--cv-bg-raised` | `#f6f8fa` | StatusBar, tool block surface |
| `--cv-bg-user-bubble` | `#2f6feb` | user bubble |
| `--cv-bg-assistant-bubble` | `#f6f8fa` | assistant bubble |
| `--cv-bg-code` | `#0d1117` | exec / code background |
| `--cv-fg-code` | `#e6edf3` | code foreground |
| `--cv-border` | `#d0d7de` | dividers |
| `--cv-axis-color` | `#d0d7de` | turn timeline axis |
| `--cv-shimmer-color` | `rgba(31,35,40,0.08)` | exec shimmer |

### Status colors

| Variable | Default | Status |
|----------|---------|--------|
| `--cv-status-pending` | `#6e7781` | gray |
| `--cv-status-running` | `#2f6feb` | blue |
| `--cv-status-completed` | `#1a7f37` | green |
| `--cv-status-failed` | `#cf222e` | red |
| `--cv-status-stopped` | `#6e7781` | gray |

### Diff colors

| Variable | Default |
|----------|---------|
| `--cv-diff-add-bg` | `#ddf4e4` |
| `--cv-diff-del-bg` | `#ffebe9` |

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
