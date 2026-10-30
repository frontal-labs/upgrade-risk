# Overview

`@frontal/upgrade-risk` is a GitHub Action and CLI tool that analyzes dependency upgrades in Dependabot/Renovate pull requests and posts risk assessments with exact code usages of affected APIs.

## How it works

1. **Detect** - Parse `package.json` and lockfiles to identify package updates
2. **Sources** - Fetch metadata from npm registry, GitHub releases, and changelogs
3. **Type diff** - Download and compare `.d.ts` files between versions
4. **Extract** - Parse breaking changes from release notes/changelogs
5. **Usage** - Find all imports/usages of affected packages and symbols via TypeScript compiler API
6. **Score** - Assign risk level based on evidence
7. **Report** - Generate `risk.json` and post/update PR comment

## Risk levels

- `safe` - No breaking changes or breaking changes don't affect used symbols
- `review` - Breaking changes found in prose but no specific symbols to search for
- `risky` - At least one removed/changed symbol is used in the repo
- `unknown` - No release notes or types found (never treated as safe)

## Architecture

All modules live under `src/`:
- `detect.ts` - Parse PR changes
- `sources/` - Registry, releases, changelog fetchers
- `typediff.ts` - Type definition comparison
- `extract.ts` - Breaking change extraction
- `usage.ts` - Usage analysis via TypeScript API
- `score.ts` - Risk scoring logic
- `schema.ts` - Risk JSON schema validation
- `cli.ts` - CLI interface
- `env.ts` - Environment variable validation

## Ground rules

- npm ecosystem only (v1)
- Never run install scripts or code from analyzed packages
- Only download tarballs and read files
- When evidence conflicts, pick higher risk
- Never mark anything safe without evidence
- No LLM required for core functionality
