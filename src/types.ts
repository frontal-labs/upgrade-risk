export const SCHEMA_ID = 'frontal.upgrade-risk/v1'

export type RiskLevel = 'safe' | 'review' | 'unknown' | 'risky'

export type BreakingSource = 'release-notes' | 'changelog' | 'type-diff' | 'llm'

export type DepType =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies'

export interface Usage {
  file: string
  line: number
  snippet: string
}

export interface BreakingChange {
  summary: string
  source: BreakingSource
  evidence: string
  quote: string
  symbols: string[]
  usages: Usage[]
}

export interface PackageUpdate {
  name: string
  from: string
  to: string
  risk: RiskLevel
  breaking: BreakingChange[]
  notesFound: boolean
  typesFound: boolean
}

export interface RiskReport {
  schema: typeof SCHEMA_ID
  pr: number
  generatedAt: string
  overall: RiskLevel
  updates: PackageUpdate[]
}

export interface DetectedUpdate {
  name: string
  from: string
  to: string
  depType: DepType
}

export const RISK_RANK: Record<RiskLevel, number> = {
  safe: 0,
  unknown: 1,
  review: 2,
  risky: 3,
}

export function worstRisk(levels: RiskLevel[]): RiskLevel {
  let worst: RiskLevel = 'safe'
  for (const level of levels) {
    if (RISK_RANK[level] > RISK_RANK[worst]) worst = level
  }
  return worst
}
