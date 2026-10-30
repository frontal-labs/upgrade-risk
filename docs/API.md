# API Reference

## CLI

```bash
bun src/cli.ts --repo owner/name --pr 123 --out ./output
```

### Options

| Option | Required | Description |
| --- | --- | --- |
| `--repo` | Yes | Repository in `owner/name` format |
| `--pr` | Yes | Pull request number |
| `--out` | Yes | Output directory for `risk.json` and `comment.md` |

### Environment

CLI reads from environment variables validated via `src/env.ts`:
- `GH_TOKEN` or `GITHUB_TOKEN`
- `GH_REPOSITORY` or `GITHUB_REPOSITORY` (fallback)

## GitHub Action

See [README](../README.md) for Action usage, inputs, and outputs.

## risk.json Schema

Schema version: `frontal.upgrade-risk/v1`

```json
{
  "schema": "frontal.upgrade-risk/v1",
  "pr": 123,
  "generatedAt": "2026-01-01T00:00:00Z",
  "overall": "risky",
  "updates": [{
    "name": "zod",
    "from": "3.23.8",
    "to": "4.0.0",
    "risk": "risky",
    "breaking": [{
      "summary": "string",
      "source": "release-notes | changelog | type-diff | llm",
      "evidence": "https://...",
      "quote": "exact line from source",
      "symbols": ["string"],
      "usages": [{ "file": "src/x.ts", "line": 42, "snippet": "string" }]
    }],
    "notesFound": true,
    "typesFound": true
  }]
}
```

### Fields

- `schema` - Schema version identifier
- `pr` - Pull request number
- `generatedAt` - ISO-8601 timestamp
- `overall` - Overall risk level for all updates
- `updates[]` - Per-package update analysis
- `updates[].breaking[]` - Detected breaking changes
- `updates[].breaking[].source` - Origin of detection
- `updates[].breaking[].evidence` - URL to source
- `updates[].breaking[].quote` - Exact quoted line from source
- `updates[].breaking[].symbols` - Affected API symbols
- `updates[].breaking[].usages` - Found usages in repo
