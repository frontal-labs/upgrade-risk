import semver from 'semver'
import type { BreakingChange, RiskLevel } from './types'

export type BumpKind = 'patch' | 'minor' | 'major'

/** 0.x minor bumps are breaking under semver, so they count as major. */
export function bumpKind(from: string, to: string): BumpKind {
  const diff = semver.diff(from, to)
  if (diff === 'patch' || diff === 'prepatch') return 'patch'
  if (diff === 'minor' || diff === 'preminor') {
    return semver.major(from) === 0 ? 'major' : 'minor'
  }
  return 'major'
}

export interface ScoreInput {
  from: string
  to: string
  breaking: BreakingChange[]
  notesFound: boolean
  typesFound: boolean
}

/**
 * Assigns one risk level to a single update.
 *
 * - risky: a breaking change names a symbol that the repo uses.
 * - review: a breaking change has no symbol to search for (prose only).
 * - unknown: no release notes and no type definitions were found. Never safe.
 * - safe: breaking changes exist but none of their symbols are used, or there is no breaking
 *   change and the evidence fits the bump (patch/minor, or a major with both sources).
 * - review: anything else, such as a major with only partial evidence.
 */
export function scoreUpdate(input: ScoreInput): RiskLevel {
  const { breaking, notesFound, typesFound } = input

  if (breaking.some((change) => change.usages.length > 0)) return 'risky'
  if (breaking.some((change) => change.symbols.length === 0)) return 'review'
  if (!notesFound && !typesFound) return 'unknown'
  if (breaking.length > 0) return 'safe'

  const kind = bumpKind(input.from, input.to)
  if (kind !== 'major') return 'safe'
  if (notesFound && typesFound) return 'safe'
  return 'review'
}
