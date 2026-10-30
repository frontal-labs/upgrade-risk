import type { BreakingSource } from './types'

export interface NoteSection {
  source: Extract<BreakingSource, 'release-notes' | 'changelog'>
  evidence: string
  text: string
}

export interface ProseBreaking {
  summary: string
  source: BreakingSource
  evidence: string
  quote: string
  symbols: string[]
}

const KEYWORDS = /breaking|\bremoved\b|no longer|\brenamed\b|\bdeprecated\b|requires node/i
const HEADING = /^\s{0,3}#{1,6}\s+|^\s*\*\*[^*]+\*\*\s*$/
const BREAKING_HEADING = /breaking/i
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'from',
  'with',
  'this',
  'that',
  'node',
  'npm',
  'bun',
  'import',
  'export',
  'default',
  'new',
  'use',
  'version',
  'breaking',
  'changes',
])

/**
 * Symbols a note line refers to: identifiers inside backticks, plus camelCase names and
 * call expressions written without backticks. Used to search the repo for usages.
 */
export function extractSymbols(line: string): string[] {
  const found = new Set<string>()
  for (const [, code] of line.matchAll(/`([^`]+)`/g)) {
    for (const [identifier] of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
      if (identifier.length > 1 && !STOP_WORDS.has(identifier.toLowerCase())) {
        found.add(identifier)
      }
    }
  }
  const unquoted = line.replace(/`[^`]*`/g, ' ')
  for (const [identifier] of unquoted.matchAll(
    /\b[a-z][a-z0-9]*[A-Z][\w$]*\b|\b[A-Za-z_$][\w$]*(?=\()/g,
  )) {
    if (!STOP_WORDS.has(identifier.toLowerCase())) found.add(identifier)
  }
  return [...found]
}

function cleanSummary(line: string): string {
  const text = line
    .replace(BULLET, '')
    .replace(/[*_]{1,2}/g, '')
    .trim()
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}

/**
 * Heuristic breaking-change extraction. Every candidate keeps the exact source line as its
 * quote, so a reader can verify it. A line counts when it matches a breaking keyword, or
 * when it sits under a "Breaking" heading.
 */
export function extractBreaking(sections: NoteSection[]): ProseBreaking[] {
  const found: ProseBreaking[] = []
  const seen = new Set<string>()

  for (const section of sections) {
    let underBreakingHeading = false
    for (const rawLine of section.text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      if (HEADING.test(line)) {
        underBreakingHeading = BREAKING_HEADING.test(line)
        continue
      }
      if (!(KEYWORDS.test(line) || (underBreakingHeading && BULLET.test(line)))) continue

      const quote = line
      const key = `${section.source}:${quote}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({
        summary: cleanSummary(line),
        source: section.source,
        evidence: section.evidence,
        quote,
        symbols: extractSymbols(line),
      })
    }
  }
  return found
}
