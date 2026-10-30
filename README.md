# @frontal/upgrade-risk

GitHub Action to post upgrade risk analysis comments on Dependabot or Renovate pull requests. Lists breaking changes between old and new versions of each updated package and exact `file:line` usages of affected APIs. Writes a machine-readable `risk.json`.

## Features

- Detects package updates from `package.json` and lockfiles
- Fetches release notes/changelogs and diffs `.d.ts` types
- Finds usages with TypeScript compiler API
- Scores risk as `safe`, `review`, `risky`, or `unknown`
- Posts a single sticky PR comment and uploads `risk.json` as artifact
- Works with zero API keys required

## Usage

```yaml
name: Upgrade Risk
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  risk:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]' || github.actor == 'renovate[bot]'
    steps:
      - uses: actions/checkout@v4
      - name: Analyze upgrade risk
        uses: frontal-labs/upgrade-risk@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          fail-on: none
          comment: true
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | GitHub token |
| `fail-on` | `none` | Fail if risk >= level (`none` \| `risky` \| `review`) |
| `comment` | `true` | Post/update PR comment |
| `llm-api-key` | (optional) | Enable LLM extraction (Phase 3) |
| `llm-model` | (optional) | Override default LLM model |

## Outputs

| Output | Description |
| --- | --- |
| `risk` | Overall risk level |
| `report-path` | Path to `risk.json` |

## License

MIT
