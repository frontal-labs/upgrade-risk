# Changelog

## Unreleased

- Initial implementation: detection, release-notes and changelog extraction, `.d.ts` type diff, TypeScript usage search, risk scoring, `risk.json` schema v1, sticky PR comment, CLI, weekly digest.
- Configurable labels in `config/tags.json`, with an override file.
- Optional LLM extraction for release notes the rules cannot parse. Model output must quote the notes verbatim, and it can only raise a risk level.
