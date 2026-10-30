# Contributing to @frontal/upgrade-risk

Thank you for your interest in contributing to `@frontal/upgrade-risk`!

## Development Setup

```bash
bun install
bun test
bun run lint
bun run typecheck
```

## Environment Variables

Environment variables are validated with `@t3-oss/env-core` and Zod in `src/env.ts`. All `process.env` usage should flow through `env.ts`.

## Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/). Commit messages are linted with commitlint.

Examples:
- `feat: add new feature`
- `fix: resolve bug`
- `docs: update documentation`
- `chore: update dependencies`
- `test: add tests`

## Code Style

- TypeScript strict mode
- Biome for linting and formatting
- No comments unless necessary
- Follow existing patterns

## Pull Request Process

1. Create a feature branch
2. Make your changes with tests
3. Ensure `bun test`, `bun run lint`, `bun run typecheck` pass
4. Submit a pull request
