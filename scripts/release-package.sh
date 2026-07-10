#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

die() {
  printf 'release: %s\n' "$*" >&2
  exit 1
}

next_version() {
  local current="$1"
  local spec="$2"
  local major minor patch

  if [[ "$spec" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s\n' "$spec"
    return
  fi
  if [[ ! "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    die "current version is not plain semver: $current"
  fi

  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  patch="${BASH_REMATCH[3]}"
  case "$spec" in
    major) printf '%s.0.0\n' "$((major + 1))" ;;
    minor) printf '%s.%s.0\n' "$major" "$((minor + 1))" ;;
    patch) printf '%s.%s.%s\n' "$major" "$minor" "$((patch + 1))" ;;
    *) die "version must be patch, minor, major, or X.Y.Z" ;;
  esac
}

package_key="${1:-}"
[[ -n "$package_key" ]] || die "internal package key is required"
shift

case "$package_key" in
  adapters)
    package_name="@codexview/adapters"
    package_dir="packages/adapters"
    tag_prefix="adapters-v"
    workflow="publish-adapters.yml"
    ;;
  cli)
    package_name="@codexview/cli"
    package_dir="packages/cli"
    tag_prefix="cli-v"
    workflow="publish-cli.yml"
    ;;
  react)
    package_name="@codexview/react"
    package_dir="packages/react"
    tag_prefix="v"
    workflow="release.yml"
    ;;
  *)
    die "unsupported package key: $package_key"
    ;;
esac

usage() {
  cat <<USAGE
Usage:
  ./release.sh <patch|minor|major|X.Y.Z> [--publish]
  ./release.sh --help

Without --publish, this runs install, typecheck, tests, and build without
changing the package version. Add --publish to bump the version, commit and
push main, push the package release tag, wait for $workflow, and verify npm.
USAGE
}

publish=false
version_spec=""

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --publish)
      publish=true
      ;;
    -*)
      die "unknown option: $arg"
      ;;
    *)
      [[ -z "$version_spec" ]] || die "only one version argument is allowed"
      version_spec="$arg"
      ;;
  esac
done

[[ -n "$version_spec" ]] || {
  usage
  exit 2
}

for command in git node npm pnpm; do
  command -v "$command" >/dev/null 2>&1 || die "missing command: $command"
done

[[ "$(git branch --show-current)" == "main" ]] || die "releases must run on main"
[[ -z "$(git status --porcelain)" ]] || die "worktree must be clean before release"

git fetch origin main
[[ "$(git rev-list --left-right --count origin/main...HEAD)" == $'0\t0' ]] ||
  die "local main must exactly match origin/main"

current_version="$(node -p "require('./$package_dir/package.json').version")"
target_version="$(next_version "$current_version" "$version_spec")"
tag="$tag_prefix$target_version"

printf 'Package: %s\nCurrent: %s\nTarget:  %s\nTag:     %s\n' \
  "$package_name" "$current_version" "$target_version" "$tag"

CI=true pnpm install --frozen-lockfile
if [[ "$package_key" == "cli" ]]; then
  pnpm --filter @codexview/adapters build
fi
pnpm --filter "$package_name" typecheck
CI=true pnpm --filter "$package_name" test
pnpm --filter "$package_name" build

pack_dir="$(mktemp -d)"
trap 'rm -rf "$pack_dir"' EXIT
pnpm --dir "$package_dir" pack --pack-destination "$pack_dir" >/dev/null

if [[ "$publish" != true ]]; then
  printf 'Dry run complete. Publish with: ./release.sh %s --publish\n' \
    "$target_version"
  exit 0
fi

command -v gh >/dev/null 2>&1 || die "missing command: gh"
gh auth status >/dev/null 2>&1 || die "GitHub CLI is not authenticated"

if npm view "$package_name@$target_version" version >/dev/null 2>&1; then
  die "$package_name@$target_version is already published"
fi
if git rev-parse "$tag" >/dev/null 2>&1 ||
  git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  die "release tag already exists: $tag"
fi

if [[ "$target_version" != "$current_version" ]]; then
  (
    cd "$package_dir"
    npm pkg set "version=$target_version"
  )
  git add "$package_dir/package.json"
  git commit -m "release($package_key): $target_version"
  git push origin main
else
  printf 'Version already set to %s; continuing with tag creation.\n' \
    "$target_version"
fi

git tag "$tag"
git push origin "$tag"

run_id=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  run_id="$(gh run list \
    --repo codexview/codexview \
    --workflow "$workflow" \
    --branch "$tag" \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty')"
  [[ -n "$run_id" ]] && break
  sleep 3
done
[[ -n "$run_id" ]] || die "timed out waiting for $workflow to start"

gh run watch "$run_id" --repo codexview/codexview --exit-status

for _ in 1 2 3 4 5 6 7 8 9 10; do
  published="$(npm view "$package_name@$target_version" version 2>/dev/null || true)"
  if [[ "$published" == "$target_version" ]]; then
    printf 'Published and verified: %s@%s\n' "$package_name" "$target_version"
    exit 0
  fi
  sleep 3
done

die "workflow succeeded but npm registry verification timed out"
