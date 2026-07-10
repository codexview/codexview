# AGENTS.md

This directory is the source of truth for `@codexview/adapters`.

## Component scope

- Responsibility: Stateless adapters that convert agent transcripts into CodexView events.
- Registry: public npm.
- Current consumer: AgentWeb frontend and other CodexView consumers.
- The authoritative current version is the `version` field in this directory's
  `package.json`.

## Mandatory change and release workflow

1. Make component-owned behavior changes in this directory first. Do not copy
   or patch this component's logic inside a consuming project.
2. Add or update focused tests, keeping the change scoped to this component.
3. Run `./release.sh patch` (or `minor`, `major`, or an exact `X.Y.Z`)
   to ensure dependencies are present and run typecheck, tests, build, and
   package checks.
   This is a safe dry run and does not change the version or publish anything.
4. When the worktree is clean, reviewed, and ready, run
   `./release.sh patch --publish`. Choose the semver level that matches the
   compatibility impact.
5. The script pushes an adapters-vX.Y.Z tag and waits for publish-adapters.yml to publish through GitHub Actions OIDC.
6. Only after the registry verification succeeds may an Agent update the
   consuming project's `package.json`, lockfile, integration code, tests, and
   deployment.

## Release command policy

- `release.sh` is the canonical release entry point. Use
  `./release.sh --help` for its concise interface.
- Do not edit installed copies under `node_modules`.
- Do not replace the published dependency with a local `file:` dependency.
- Do not run ad-hoc version, tag, push, or publish command sequences when the
  release script supports the operation.
- Never print, commit, or persist registry tokens in this repository.
- If a failed release requires manual recovery, inspect the pushed commit,
  tag, workflow, and registry state before taking action; never delete or
  overwrite a published version.
