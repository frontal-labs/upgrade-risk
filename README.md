# @frontal/upgrade-risk

GitHub Action that posts one comment on every Dependabot or Renovate pull request. The comment lists the breaking changes between the old and new version of each updated npm package, and the exact `file:line` places in your repo that use the affected APIs. It also writes a machine-readable `risk.json`.

No API key is needed. The optional LLM step is off unless you set `llm-api-key`.

## Usage

```yaml
name: Upgrade risk
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  risk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - id: risk
        uses: frontal-labs/upgrade-risk@v1
        with:
          github-token: ${{ secrets.DEPENDABOT_TOKEN || github.token }}
      - uses: actions/upload-artifact@v4
        with:
          name: risk-json
          path: ${{ steps.risk.outputs.report-path }}
```

### Dependabot and read-only tokens

Workflows triggered by a Dependabot PR get a read-only `GITHUB_TOKEN`, and they only see secrets stored under **Settings → Secrets and variables → Dependabot**. Declaring `pull-requests: write` does not change that. To post the comment on Dependabot PRs, create a token with `pull-requests: write` on the repo and store it as the Dependabot secret `DEPENDABOT_TOKEN`. The snippet above uses it when it exists.

Renovate PRs get the normal token, so `github.token` works for them.

## Example comment (illustrative)

The names and lines below are made up to show the format.

```
## Upgrade risk: 🔴 Risky

1 breaking change affects 2 places in your code.

▸ zod 3.23.8 → 4.0.0 · 🔴 Risky
  - `z.string().email()` was removed (release notes, source)
    > - `z.string().email()` was removed, use `z.email()` instead
    - src/schema.ts:12 — `email: z.string().email(),`
    - src/forms/signup.ts:4 — `z.string().email().min(3)`
```

Each usage links to `blob/<head sha>/<file>#L<line>`. Packages with no notes and no type definitions say so, and get the `unknown` level.

## Gating auto-merge

```yaml
- name: Auto-merge safe bumps
  if: steps.risk.outputs.risk == 'safe'
  run: gh pr merge --auto --merge "$PR_URL"
  env:
    PR_URL: ${{ github.event.pull_request.html_url }}
    GH_TOKEN: ${{ secrets.DEPENDABOT_TOKEN }}
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token used to read the PR and post the comment. See the Dependabot note above. |
| `fail-on` | `none` | Fail the job when the overall level is at or above this: `none`, `review` or `risky`. |
| `comment` | `true` | Post or update the sticky PR comment. |
| `force` | `false` | Analyze PRs from any author, not only Dependabot and Renovate. |
| `tags` | `""` | Path to a JSON file that overrides labels. See [Labels](#labels). |
| `llm-api-key` | `""` | Anthropic API key. Enables LLM extraction for notes the rules cannot parse. |
| `llm-model` | `claude-sonnet-5-5` | Model used with `llm-api-key`. |

## Outputs

| Output | Description |
| --- | --- |
| `risk` | Overall level: `safe`, `review`, `unknown` or `risky`. Empty when the PR is skipped. |
| `report-path` | Path to the `risk.json` written for this run. |

## Risk levels

| Level | Meaning |
| --- | --- |
| `risky` | A removed or changed symbol is used in the repo. |
| `review` | A breaking change is described only in prose, with no symbol to search for. Or a major upgrade has partial evidence. |
| `unknown` | No release notes and no type definitions were found. Never treated as safe. |
| `safe` | Breaking changes exist but none of their symbols are used, or there is no breaking change and the evidence fits the bump. |

When evidence conflicts, the higher level wins.

## Labels

Human-facing labels live in [`config/tags.json`](config/tags.json): level names, icons, descriptions, headline wording, source labels, and the footer. Pass an override file with `tags:` (Action) or `--tags` (CLI). Keys you leave out keep the default.

```json
{
  "risk": { "risky": { "label": "Breaking", "icon": "⛔" } },
  "headlines": { "risky": "{breaking} {verb} {places} in your code." }
}
```

The machine values in `risk.json` (`safe`, `risky`, ...) are part of the schema and cannot be renamed.

## risk.json

Schema `frontal.upgrade-risk/v1`. See [docs/API.md](docs/API.md).

## Weekly digest

`bun src/digest.ts --repo owner/name --out ./output` lists the open Dependabot and Renovate PRs, analyzes each one, and writes `digest.json` and `slack-payload.json` (same shape as `top-issues`). See [`examples/weekly-digest.yml`](examples/weekly-digest.yml).

## CLI

```bash
bun src/cli.ts --repo owner/name --pr 123 --out ./output
```

Set `GH_TOKEN` for private repos or to avoid rate limits. Add `--workspace .` to scan a local checkout, and `--cache dir` to record and reuse API responses.

## Development

```bash
bun install
bun test
bun run lint
bun run typecheck
bun run eval     # accuracy of the recorded fixtures (offline)
bun run build    # rebuilds dist/, which CI checks
```

## License

MIT
