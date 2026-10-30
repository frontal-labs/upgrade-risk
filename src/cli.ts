#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { analyzePr } from './analyze'
import { createCache } from './cache'
import { renderComment } from './comment'
import { loadTags } from './config'
import { env } from './env'
import { DEFAULT_LLM_MODEL, anthropicComplete } from './llm'
import { parseRiskReport } from './schema'
import { createGitHubSource } from './sources/github'
import { createNpmSource } from './sources/npm'

const USAGE = `Usage: bun src/cli.ts --pr <number> [--repo owner/name] [--out dir]

Options:
  --repo <owner/name>   Repository (default: GH_REPOSITORY or GITHUB_REPOSITORY)
  --pr <number>         Pull request number
  --out <dir>           Output directory for risk.json and comment.md (default: ./output)
  --workspace <dir>     Scan this local checkout instead of downloading the PR head
  --cache <dir>         Record and reuse API responses in this directory
  --tags <file.json>    Override labels from config/tags.json
  --llm                 Use the LLM for notes the rules cannot parse (needs ANTHROPIC_API_KEY)
  --llm-model <name>    Model for --llm (default: ${DEFAULT_LLM_MODEL})

Environment: GH_TOKEN or GITHUB_TOKEN (optional for public repositories).`

function llmOptions(model?: string) {
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('--llm needs ANTHROPIC_API_KEY')
  return {
    complete: anthropicComplete(apiKey),
    model: model ?? DEFAULT_LLM_MODEL,
    cache: createCache(),
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      pr: { type: 'string' },
      out: { type: 'string', default: './output' },
      workspace: { type: 'string' },
      cache: { type: 'string' },
      tags: { type: 'string' },
      llm: { type: 'boolean', default: false },
      'llm-model': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  })

  if (values.help) {
    console.log(USAGE)
    return
  }

  const repo = values.repo ?? env.GH_REPOSITORY ?? env.GITHUB_REPOSITORY
  const pr = Number(values.pr)
  if (!repo || !Number.isInteger(pr) || pr <= 0) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const { report, headSha } = await analyzePr({
    repo,
    pr,
    github: createGitHubSource(env.GH_TOKEN ?? env.GITHUB_TOKEN),
    npm: createNpmSource(),
    cache: createCache({ dir: values.cache, mode: 'record' }),
    workspace: values.workspace,
    llm: values.llm ? llmOptions(values['llm-model']) : undefined,
  })

  const validated = parseRiskReport(report)
  mkdirSync(values.out, { recursive: true })
  writeFileSync(join(values.out, 'risk.json'), `${JSON.stringify(validated, null, 2)}\n`)
  writeFileSync(
    join(values.out, 'comment.md'),
    renderComment(validated, { repo, sha: headSha, tags: loadTags(values.tags) }),
  )

  console.log(`Overall: ${validated.overall} (${validated.updates.length} update(s))`)
  console.log(`Wrote ${join(values.out, 'risk.json')} and ${join(values.out, 'comment.md')}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
