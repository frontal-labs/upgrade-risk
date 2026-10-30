---
"@frontal/upgrade-risk": minor
---

Initial release: detects dependency updates in Dependabot and Renovate PRs, extracts breaking changes from release notes, changelogs and type diffs, finds their usages with the TypeScript compiler API, scores each update as safe, review, unknown or risky, and posts a sticky PR comment. Labels are configurable through `config/tags.json`. The LLM step is optional.
