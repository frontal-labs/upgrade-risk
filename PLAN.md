You are building `@frontal/upgrade-risk`, an open-source GitHub Action for Frontal Labs. It posts one comment on every Dependabot or Renovate pull request. The comment lists the breaking changes between the old and new versions of each updated package, and the exact `file:line` places in the repo that use the affected APIs. It also writes a machine-readable `risk.json` file.

Work in phases. After each phase, stop. Report what you built, the test results, and any open questions, then wait for my go-ahead before starting the next phase.

## Ground rules

- Repo: `frontal-labs/upgrade-risk`. MIT license.
- Copy the tooling from `frontal-labs/top-issues`: Bun for dev and tests, `@octokit/rest`, Biome, husky, lint-staged, commitlint (conventional commits), changesets, `.editorconfig`, `.nvmrc`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and a `meta.json` in the same shape. Read that repo first and match its conventions.
- Language: TypeScript, strict mode.
- Ecosystem for v1: npm only (TypeScript and JavaScript source; lockfiles `bun.lock`, `package-lock.json`, `pnpm-lock.yaml`).
- Never run install scripts or code from the packages being analyzed. Only download tarballs and read files.
- When evidence conflicts, pick the higher risk. Never mark anything "safe" without evidence.
- No LLM is required. The tool must be useful with zero API keys.

## Phase 0: Repo setup

1. Scaffold the repo with the tooling above.
2. In `package.json`, don't set `"private": true`, and use the name `@frontal/upgrade-risk`.
3. `top-issues` installs `@frontal/style-guide` over `git+ssh`. Don't do that here, because outside contributors can't install it. Inline the Biome config in `biome.json`.
4. Add `.github/workflows/ci.yml` that runs lint, typecheck and tests with Bun. Make sure it passes.
5. Write `meta.json`:
   - `"name": "frontal-upgrade-risk"`, `"type": "tool"`, `"domain": "developer-productivity"`, `"product": "frontal"`
   - `"capabilities": ["upgrade-risk-scoring", "breaking-change-extraction", "usage-analysis", "automated-reporting"]`
   - `"integrations": ["github"]`, `"visibility": "public"`, `"status": "active"`
6. Create `tests/fixtures/` with a README explaining the format of labeled test cases (see Phase 1, step 7).

Done when: CI is green on an empty `src/index.ts` and `bun install` works without SSH access.

## Phase 1: Core engine and CLI (no LLM)

Build each step of the pipeline as its own module under `src/`, with unit tests that use saved fixtures. Tests must not make network calls; record API responses into fixtures instead.

1. `src/detect.ts`: from the PR's changed files (`package.json` and lockfiles), output a list of `{ name, from, to, depType }`. Support grouped PRs that update several packages.
2. `src/sources/registry.ts`: get package metadata from the npm registry, including the `repository` field and the tarball URL for each version.
3. `src/sources/releases.ts`: fetch GitHub Releases for every version after `from` up to and including `to`.
4. `src/sources/changelog.ts`: if there are no releases, read `CHANGELOG.md` from the tarball and slice out the relevant version range.
5. `src/typediff.ts`: download the `from` and `to` tarballs and read their `.d.ts` files (follow the `types`/`typings`/`exports` fields, and fall back to `@types/<name>` when needed). Compare exported symbols and classify each change as `removed`, `renamed` (best guess), `signature-changed` or `added`.
6. `src/extract.ts`: pull breaking changes out of notes using heuristics: headings or lines containing BREAKING, "removed", "no longer", "renamed", "deprecated", "requires Node". Each item must include the source URL and the exact quoted line.
7. `src/usage.ts`: use the TypeScript compiler API to find imports of the package (named, default, namespace, `require`, dynamic `import()`, and subpath imports). Resolve uses of each affected symbol and return `{ file, line, column, snippet }`. Only scan files that import the package. Cache results by commit hash.
8. `src/score.ts` assigns exactly one risk level per update:
   - `safe`: there's evidence of no breaking changes (patch or minor bump, notes found, empty type diff), OR breaking changes exist but none of their symbols are used.
   - `review`: breaking changes found only in prose, with no symbol to search for (behaviour, config or runtime requirements).
   - `risky`: at least one removed or changed symbol is used in the repo.
   - `unknown`: no notes and no type definitions. Never treat this as `safe`.
9. `src/schema.ts`: define and validate the `risk.json` output. Treat it as a public API with a version field:
   ```json
   {
     "schema": "frontal.upgrade-risk/v1",
     "pr": 123,
     "generatedAt": "ISO-8601",
     "overall": "risky",
     "updates": [{
       "name": "zod", "from": "3.23.8", "to": "4.0.0", "risk": "risky",
       "breaking": [{
         "summary": "string",
         "source": "release-notes | changelog | type-diff | llm",
         "evidence": "url",
         "quote": "exact line from source",
         "symbols": ["string"],
         "usages": [{ "file": "src/x.ts", "line": 42, "snippet": "string" }]
       }],
       "notesFound": true,
       "typesFound": true
     }]
   }
   ```
10. `src/cli.ts`: `bun src/cli.ts --repo owner/name --pr 123 --out ./output` writes `./output/risk.json` and `./output/comment.md`. Read `GH_TOKEN` and `GH_REPOSITORY` the same way `top-issues` does.
11. Test set: collect about 30 real, already-merged or reverted Dependabot PRs from popular TypeScript repos. Mix them: some patch bumps, some majors that broke builds, some majors that didn't. Save each one as a fixture with my expected label. Add `bun run eval`, which prints accuracy per risk level and lists every mismatch.

Done when: `bun test` passes, `bun run eval` shows zero cases where the expected label is `risky` or `unknown` but the output is `safe`, and you've shared the full eval table with me.

## Phase 2: GitHub Action and PR comment (tag v0.1)

1. Write `action.yml`:
   - Inputs: `github-token` (default `${{ github.token }}`), `fail-on` (`none | risky | review`, default `none`), `comment` (default `true`), `llm-api-key` (optional, unused until Phase 3).
   - Outputs: `risk` (overall level) and `report-path`.
   - Runtime: `runs.using: node24`, `main: dist/index.js`.
2. Bundle with `bun build src/action.ts --target=node --outfile dist/index.js` and commit `dist/`. Add a CI check that fails if `dist/` is out of date.
3. Only run when the PR author is `dependabot[bot]` or `renovate[bot]`, or when the `force` input is true. Otherwise exit cleanly.
4. Post a single sticky comment, found by the hidden marker `<!-- frontal-upgrade-risk -->`, and update it in place on new pushes. Comment format:
   - Headline: overall risk, plus a one-line answer ("Safe to merge: no breaking changes touch your code", or "3 breaking changes affect 5 places in your code").
   - One collapsible section per package: version range, risk level, each breaking change with its quoted source line and link, and each usage as a link to `blob/<sha>/<file>#L<line>`.
   - When the level is `unknown`, say plainly that no release notes or types were found.
   - Footer: link to the repo and the schema version.
5. Upload `risk.json` as a workflow artifact.
6. Use only the `pull_request` trigger. Never use `pull_request_target`, and never run PR code.
7. README: write a 10-line copy-paste workflow that includes `permissions: contents: read, pull-requests: write`. Explain that workflows triggered by Dependabot get a read-only token by default and only see Dependabot secrets. Add a sample comment, a table of inputs and outputs, and how to gate auto-merge on `steps.risk.outputs.risk == 'safe'`.
8. Use changesets for releases, and keep a moving `v1` tag updated on each release.

Done when: the Action works end to end on a test repo with at least one real Dependabot PR, and the comment renders correctly. Send me screenshots or the raw markdown.

## Phase 3: Optional LLM extraction

1. Only enabled when `llm-api-key` is set. Default to the current Claude Sonnet model, with a `llm-model` input to override it.
2. Use it only in `extract.ts`, for release notes the heuristics can't parse well. The model must return structured JSON, and each item must quote its source line exactly.
3. Verification: drop any item whose quote doesn't appear word for word in the fetched notes.
4. The LLM can add breaking changes or raise a risk level, but it can never lower a level the rules assigned.
5. Label LLM-derived items with `"source": "llm"` in `risk.json` and with a marker in the comment.
6. Re-run `bun run eval` with and without the LLM, and report the difference.

Done when: the eval shows no new false "safe" results and the LLM step adds measurable recall.

## Phase 4: Weekly digest (v1.0)

1. Add `bun src/digest.ts --repo owner/name --out ./output`. It lists all open Dependabot and Renovate PRs, runs the engine on each one (reusing cached results), and ranks them risky > review > unknown > safe.
2. Write `./output/slack-payload.json` in the same format as `top-issues` (`prelude`, `itemNURL`, `itemNText`), so it plugs into the same Slack posting step.
3. Add `examples/weekly-digest.yml` that runs every Monday at 13:00 UTC, matching `top-issues`.
4. Finish the docs: `docs/OVERVIEW.md`, `docs/API.md` (CLI, Action and `risk.json` schema), and add a CHANGELOG entry for v1.0.
5. Prepare the GitHub Marketplace listing: branding icon and color in `action.yml`, plus a short description.

Done when: the digest runs on a schedule in a test repo and posts to Slack, and v1.0 is tagged.

## Out of scope (don't build)

Codemods, opening the tool's own PRs, auto-merging, non-npm ecosystems, org-wide dashboards, and a hosted service.

## Reporting format after each phase

- What you built (files and modules)
- Test and eval results (paste the numbers)
- Shortcuts you took or assumptions you made
- Open questions for me
