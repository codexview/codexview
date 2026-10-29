#!/usr/bin/env bash
set -euo pipefail

key="${1:-}"
case "$key" in
  adapters) prefix=adapters-v ;;
  runtime) prefix=runtime-v ;;
  cli) prefix=cli-v ;;
  react) prefix=v ;;
  *) echo '::error::unknown release package' >&2; exit 1 ;;
esac

version="$(node -p "require('./packages/$key/package.json').version")"
if [[ "${GITHUB_REF_TYPE:-}" != tag || "${GITHUB_REF_NAME:-}" != "$prefix$version" ]]; then
  echo "::error::publication requires the exact $prefix$version tag ref" >&2
  exit 1
fi
