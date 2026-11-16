# Changelog

## 0.1.3

### Patch Changes

- Add `--ignore-scripts` to the composite action's `bun install`. The package's
  `prepare` script runs `husky` (a dev tool, not a runtime dependency), so
  `bun install --production` exited 127 with "husky: command not found" before
  the entrypoint could build or run.

## 0.1.2

### Patch Changes

- Convert `action.yml` from a `node24` action to a composite action. `dist/` is gitignored, so the bundled `dist/index.js` was never present in the release tag and the action failed at load time. The composite action now installs dependencies and builds the entrypoint in-job, and exposes the `with:` inputs to the bundled entrypoint the same way the node24 runner does. The `github-token` input no longer defaults to `${{ github.token }}`; it falls back to the workflow's `GITHUB_TOKEN`.

## 0.1.1

### Patch Changes

- Fix Biome 2 configuration (`files.includes` schema keys, rule overrides for legitimate namespace imports and bitwise operator usage) so `bun run lint` passes in CI.
- Apply Biome autofix across the codebase (quote style, semicolons, object key sorting); no behavioral changes.

## 0.1.0

### Minor Changes

- 1b3eebd: Initial release: detects dependency updates in Dependabot and Renovate PRs, extracts breaking changes from release notes, changelogs and type diffs, finds their usages with the TypeScript compiler API, scores each update as safe, review, unknown or risky, and posts a sticky PR comment. Labels are configurable through `config/tags.json`. The LLM step is optional.

## Unreleased

- Initial implementation: detection, release-notes and changelog extraction, `.d.ts` type diff, TypeScript usage search, risk scoring, `risk.json` schema v1, sticky PR comment, CLI, weekly digest.
- Configurable labels in `config/tags.json`, with an override file.
- Optional LLM extraction for release notes the rules cannot parse. Model output must quote the notes verbatim, and it can only raise a risk level.
