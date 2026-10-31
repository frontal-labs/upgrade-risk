# Changelog

## 0.1.0

### Minor Changes

- 1b3eebd: Initial release: detects dependency updates in Dependabot and Renovate PRs, extracts breaking changes from release notes, changelogs and type diffs, finds their usages with the TypeScript compiler API, scores each update as safe, review, unknown or risky, and posts a sticky PR comment. Labels are configurable through `config/tags.json`. The LLM step is optional.

## Unreleased

- Initial implementation: detection, release-notes and changelog extraction, `.d.ts` type diff, TypeScript usage search, risk scoring, `risk.json` schema v1, sticky PR comment, CLI, weekly digest.
- Configurable labels in `config/tags.json`, with an override file.
- Optional LLM extraction for release notes the rules cannot parse. Model output must quote the notes verbatim, and it can only raise a risk level.
