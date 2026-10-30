import { type Tags, defaultTags } from './config'
import type { BreakingChange, PackageUpdate, RiskLevel, RiskReport } from './types'

export const COMMENT_MARKER = '<!-- frontal-upgrade-risk -->'
export const TOOL_REPO_URL = 'https://github.com/frontal-labs/upgrade-risk'

export interface CommentOptions {
  repo: string
  /** Commit that the links point at (the PR head). */
  sha?: string
  /** Human-facing labels. Defaults to config/tags.json. */
  tags?: Tags
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

function headline(report: RiskReport, tags: Tags): string {
  const breaking = report.updates.flatMap((update) => update.breaking)
  const affected = breaking.filter((change) => change.usages.length > 0)
  const places = new Set(
    affected.flatMap((change) => change.usages.map((usage) => `${usage.file}:${usage.line}`)),
  )
  const prose = breaking.filter((change) => change.symbols.length === 0).length
  switch (report.overall) {
    case 'risky':
      return fill(tags.headlines.risky, {
        breaking: plural(affected.length, 'breaking change'),
        verb: affected.length === 1 ? 'affects' : 'affect',
        places: plural(places.size, 'place'),
      })
    case 'review':
      return prose === 0
        ? tags.headlines.partial
        : fill(tags.headlines.review, { prose: plural(prose, 'breaking change') })
    case 'unknown':
      return tags.headlines.unknown
    default:
      return tags.headlines.safe
  }
}

function usageLink(repo: string, sha: string | undefined, file: string, line: number): string {
  const ref = sha ?? 'HEAD'
  return `[${file}:${line}](https://github.com/${repo}/blob/${ref}/${file}#L${line})`
}

function badge(level: RiskLevel, tags: Tags): string {
  const tag = tags.risk[level]
  return `${tag.icon} ${tag.label}`.trim()
}

function renderUpdate(
  update: PackageUpdate,
  options: Required<Pick<CommentOptions, 'repo' | 'tags'>> & Pick<CommentOptions, 'sha'>,
): string {
  const { tags } = options
  const lines: string[] = []
  lines.push('<details>')
  lines.push(
    `<summary><b>${update.name}</b> ${update.from} → ${update.to} · ${badge(update.risk, tags)}</summary>`,
  )
  lines.push('')
  if (update.risk === 'unknown') {
    lines.push(
      'No release notes or type definitions were found for this update, so it cannot be assessed.',
      '',
    )
  }
  if (update.breaking.length === 0 && update.risk !== 'unknown') {
    lines.push(
      update.notesFound || update.typesFound
        ? 'No breaking changes found in the release notes or type diff.'
        : 'No breaking changes found.',
      '',
    )
  }
  for (const change of update.breaking) {
    lines.push(renderChange(change, options, tags))
  }
  lines.push('', '</details>', '')
  return lines.join('\n')
}

function renderChange(
  change: BreakingChange,
  options: { repo: string; sha?: string },
  tags: Tags,
): string {
  const lines: string[] = []
  const tag = change.source === 'llm' ? ` · ${tags.sources.llm}` : ''
  lines.push(
    `- ${change.summary} (${tags.sources[change.source]}, [source](${change.evidence}))${tag}`,
  )
  lines.push(`  > ${change.quote.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')}`)
  for (const usage of change.usages) {
    const snippet = usage.snippet.replace(/`/g, "'")
    lines.push(
      `  - ${usageLink(options.repo, options.sha, usage.file, usage.line)} — \`${snippet}\``,
    )
  }
  return lines.join('\n')
}

/** Markdown for the sticky PR comment. The marker lets the Action find and update it. */
export function renderComment(report: RiskReport, options: CommentOptions): string {
  const tags = options.tags ?? defaultTags
  const lines = [
    COMMENT_MARKER,
    `## Upgrade risk: ${badge(report.overall, tags)}`,
    '',
    headline(report, tags),
    '',
  ]
  for (const update of report.updates) {
    lines.push(renderUpdate(update, { repo: options.repo, sha: options.sha, tags }))
  }
  const footer = fill(tags.footer, { repoUrl: TOOL_REPO_URL, schema: report.schema })
  lines.push(`<sub>${footer}</sub>`, '')
  return lines.join('\n')
}
