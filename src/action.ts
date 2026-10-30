import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Octokit } from '@octokit/rest'
import { analyzePr } from './analyze'
import { createCache } from './cache'
import { COMMENT_MARKER, renderComment } from './comment'
import { loadTags } from './config'
import { DEFAULT_LLM_MODEL, anthropicComplete } from './llm'
import { parseRiskReport } from './schema'
import { createGitHubSource } from './sources/github'
import { createNpmSource } from './sources/npm'
import { RISK_RANK, type RiskLevel } from './types'

const DEPENDENCY_BOTS = new Set(['dependabot[bot]', 'renovate[bot]'])
const FAIL_LEVELS = new Set<RiskLevel | 'none'>(['none', 'review', 'risky'])

/** Reads an action input. GitHub passes `with:` values as INPUT_<NAME> environment variables. */
function input(name: string, fallback: string): string {
  const value = process.env[`INPUT_${name.toUpperCase()}`]
  return value && value.trim() !== '' ? value.trim() : fallback
}

/** Writes a step output, or prints it when not running under GitHub Actions. */
function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT
  if (file) {
    appendFileSync(file, `${name}=${value}\n`)
  } else {
    console.log(`output ${name}=${value}`)
  }
}

function notice(message: string): void {
  console.log(`::notice::${message}`)
}

async function run(): Promise<void> {
  const token = input('github-token', process.env.GITHUB_TOKEN ?? '')
  const failOn = input('fail-on', 'none') as RiskLevel | 'none'
  const shouldComment = input('comment', 'true') === 'true'
  const force = input('force', 'false') === 'true'
  const llmKey = input('llm-api-key', '')

  if (!FAIL_LEVELS.has(failOn)) {
    throw new Error(`fail-on must be one of none, review, risky (got "${failOn}")`)
  }

  const repo = process.env.GITHUB_REPOSITORY
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!repo || !eventPath) throw new Error('This action must run on a pull_request event')
  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
    pull_request?: { number: number; user?: { login?: string } }
  }
  const pull = event.pull_request
  if (!pull) throw new Error('This action must run on a pull_request event')

  const author = pull.user?.login ?? ''
  if (!DEPENDENCY_BOTS.has(author) && !force) {
    notice(`Skipping: PR author "${author}" is not a dependency bot.`)
    setOutput('risk', '')
    setOutput('report-path', '')
    return
  }

  const workspace = process.env.GITHUB_WORKSPACE
  const hasCheckout = workspace !== undefined && existsSync(join(workspace, 'package.json'))
  const outDir = join(process.env.RUNNER_TEMP ?? process.cwd(), 'upgrade-risk')
  mkdirSync(outDir, { recursive: true })

  const { report, headSha } = await analyzePr({
    repo,
    pr: pull.number,
    github: createGitHubSource(token || undefined),
    npm: createNpmSource(),
    cache: createCache(),
    workspace: hasCheckout ? workspace : undefined,
    llm: llmKey
      ? {
          complete: anthropicComplete(llmKey),
          model: input('llm-model', DEFAULT_LLM_MODEL),
          cache: createCache(),
        }
      : undefined,
  })
  const validated = parseRiskReport(report)

  const reportPath = join(outDir, 'risk.json')
  writeFileSync(reportPath, `${JSON.stringify(validated, null, 2)}\n`)
  setOutput('risk', validated.overall)
  setOutput('report-path', reportPath)

  const tagsFile = input('tags', '')
  const tags = loadTags(tagsFile || undefined)
  const body = renderComment(validated, { repo, sha: headSha, tags })
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)

  if (shouldComment && validated.updates.length > 0) {
    if (!token) throw new Error('A github-token is required to post the PR comment')
    await upsertComment(token, repo, pull.number, body)
  }

  if (failOn !== 'none' && RISK_RANK[validated.overall] >= RISK_RANK[failOn]) {
    console.error(`::error::Upgrade risk is ${validated.overall}, at or above fail-on=${failOn}.`)
    process.exitCode = 1
  }
}

/** Creates the sticky comment, or updates the one left by an earlier run on this PR. */
async function upsertComment(token: string, repo: string, pr: number, body: string): Promise<void> {
  const octokit = new Octokit({ auth: token })
  const [owner, name] = repo.split('/') as [string, string]
  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner,
    repo: name,
    issue_number: pr,
    per_page: 100,
  })
  const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER))
  if (existing) {
    await octokit.issues.updateComment({ owner, repo: name, comment_id: existing.id, body })
  } else {
    await octokit.issues.createComment({ owner, repo: name, issue_number: pr, body })
  }
}

run().catch((error: unknown) => {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
