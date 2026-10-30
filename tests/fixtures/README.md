# Test fixtures

Tests never touch the network. Every external response that a test needs is recorded once and stored here, then replayed by the test.

## Layout

```
tests/fixtures/
  README.md
  <case-id>/
    case.json        # labeled test case (format below)
    ...              # recorded inputs: registry JSON, releases JSON, PR files, .d.ts snippets, etc.
```

`<case-id>` is `<owner>-<repo>-pr<number>`, for example `colinhacks-zod-pr1234`.

## `case.json`

```json
{
  "id": "colinhacks-zod-pr1234",
  "repo": "colinhacks/zod",
  "pr": 1234,
  "expected": "risky",
  "expectedNote": "zod v4 removed z.string().email(); used in src/schema.ts",
  "sources": "https://github.com/colinhacks/zod/pull/1234",
  "updates": [{ "name": "zod", "from": "3.23.8", "to": "4.0.0" }]
}
```

Fields:

- `id`: must match the directory name.
- `repo`, `pr`: where the case came from. Used to label the source of the recording.
- `expected`: one of `safe`, `review`, `risky`, `unknown`. This is the label the engine must reproduce, or at least not be safer than (see `bun run eval`).
- `expectedNote`: one line explaining why the label is right. Required, so a reviewer can disagree with it.
- `sources`: link to the PR or evidence used for the label.
- `updates`: the expected package updates, used to check detection.

## Labeling rules

- `risky`: a removed or changed symbol is actually used by the repo at the PR head.
- `review`: breaking changes exist in prose only, with no symbol to search for.
- `unknown`: no release notes and no type definitions could be found.
- `safe`: patch or minor bump with no breaking notes and no type diff, or breaking changes that touch none of the repo's usages. Only label `safe` with evidence.
- When in doubt, label the higher risk.
