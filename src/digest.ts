#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Octokit } from '@octokit/rest'
import { analyzePr } from './analyze'
import { createCache } from './cache'
import { type Tags, loadTags } from './config'
import { env } from './env'
import { createGitHubSource } from './sources/github'
import { createNpmSource } from './sources/npm'
import { RISK_RANK, type RiskLevel, type RiskReport } from './types'

const DEPENDENCY_BOTS = new Set(['dependabot[bot]', 'renovate[bot]'])

export interface DigestEntry {
  number: number
  title: string
  url: string
  overall: RiskLevel
  error?: string
  report?: RiskReport
}

export interface SlackPayload {
  prelude: string
  [key: string]: string
}

/** Risky first, then review, unknown, safe. Ties keep the older PR first. */
export function rankEntries(entries: DigestEntry[]): DigestEntry[] {
  return [...entries].sort(
    (a, b) => RISK_RANK[b.overall] - RISK_RANK[a.overall] || a.number - b.number,
  )
}

/** Slack payload in the same shape as top-issues: a prelude plus itemN URL and Text keys. */
export function buildSlackPayload(entries: DigestEntry[], tags: Tags, limit: number): SlackPayload {
  const ranked = rankEntries(entries)
  const count = (level: RiskLevel) => ranked.filter((entry) => entry.overall === level).length
  if (ranked.length === 0) {
    return { prelude: 'No open dependency update PRs.' }
  }
  const summary = (['risky', 'review', 'unknown', 'safe'] as const)
    .map((level) => `${count(level)} ${tags.risk[level].label.toLowerCase()}`)
    .join(', ')
  const payload: SlackPayload = {
    prelude: `${ranked.length} open dependency update PRs: ${summary}.`,
  }
  ranked.slice(0, limit).forEach((entry, index) => {
    const n = index + 1
    const tag = tags.risk[entry.overall]
    payload[`item${n}URL`] = entry.url
    payload[`item${n}Text`] = `${tag.icon} ${tag.label} · #${entry.number} ${entry.title}`.trim()
  })
  return payload
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      out: { type: 'string', default: './output' },
      cache: { type: 'string' },
      limit: { type: 'string', default: '10' },
      tags: { type: 'string' },
    },
    strict: true,
  })
  const repo = values.repo ?? env.GH_REPOSITORY ?? env.GITHUB_REPOSITORY
  if (!repo) throw new Error('Pass --repo owner/name or set GH_REPOSITORY')
  const [owner, name] = repo.split('/') as [string, string]
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN
  const octokit = new Octokit({ auth: token })
  const tags = loadTags(values.tags)

  const open = await octokit.paginate(octokit.pulls.list, {
    owner,
    repo: name,
    state: 'open',
    per_page: 100,
  })
  const bots = open.filter((pr) => DEPENDENCY_BOTS.has(pr.user?.login ?? ''))

  // PR, release and registry data change without their keys changing, so they are always read
  // live. Commit-keyed and version-keyed entries stay cached between runs.
  const cache = createCache({
    dir: values.cache ?? join(values.out, 'cache'),
    mode: 'record',
    bypass: (key) =>
      key.startsWith('gh:pull') || key.startsWith('gh:releases') || key.startsWith('npm:packument'),
  })
  const github = createGitHubSource(token)
  const npm = createNpmSource()

  const entries: DigestEntry[] = []
  for (const pr of bots) {
    try {
      const { report } = await analyzePr({ repo, pr: pr.number, github, npm, cache })
      entries.push({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        overall: report.overall,
        report,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      entries.push({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        overall: 'unknown',
        error: message,
      })
    }
  }

  mkdirSync(values.out, { recursive: true })
  const ranked = rankEntries(entries)
  writeFileSync(
    join(values.out, 'digest.json'),
    `${JSON.stringify({ repo, generatedAt: new Date().toISOString(), entries: ranked }, null, 2)}\n`,
  )
  const payload = buildSlackPayload(entries, tags, Number(values.limit))
  writeFileSync(join(values.out, 'slack-payload.json'), `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`${payload.prelude}`)
  console.log(
    `Wrote ${join(values.out, 'digest.json')} and ${join(values.out, 'slack-payload.json')}`,
  )
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
