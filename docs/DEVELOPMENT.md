# Development

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0.0
- Node.js >= 18
- Git

## Setup

```bash
bun install
```

## Scripts

| Script | Description |
| --- | --- |
| `bun test` | Run tests |
| `bun run lint` | Lint with Biome |
| `bun run format` | Format with Biome |
| `bun run typecheck` | Type check with TypeScript |
| `bun run build` | Build with Bun |
| `bun run eval` | Run evaluation suite |

## Environment Variables

All environment variables are validated in `src/env.ts` using `@t3-oss/env-core` with Zod:

```typescript
import { env } from './env'

const token = env.GH_TOKEN || env.GITHUB_TOKEN
```

## Testing

Tests use Bun's test runner. Fixtures go in `tests/fixtures/`. Tests must not make network calls - record API responses as fixtures.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
