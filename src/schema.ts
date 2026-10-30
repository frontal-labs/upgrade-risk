import { z } from 'zod'
import { type RiskReport, SCHEMA_ID } from './types'

const RiskLevel = z.enum(['safe', 'review', 'unknown', 'risky'])

const Usage = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  snippet: z.string(),
})

const BreakingChange = z.object({
  summary: z.string(),
  source: z.enum(['release-notes', 'changelog', 'type-diff', 'llm']),
  evidence: z.string(),
  quote: z.string(),
  symbols: z.array(z.string()),
  usages: z.array(Usage),
})

const PackageUpdate = z.object({
  name: z.string(),
  from: z.string(),
  to: z.string(),
  risk: RiskLevel,
  breaking: z.array(BreakingChange),
  notesFound: z.boolean(),
  typesFound: z.boolean(),
})

/** Public output format. Changing it means a new schema version string. */
export const RiskReportSchema = z.object({
  schema: z.literal(SCHEMA_ID),
  pr: z.number().int().positive(),
  generatedAt: z.iso.datetime(),
  overall: RiskLevel,
  updates: z.array(PackageUpdate),
})

export function parseRiskReport(value: unknown): RiskReport {
  return RiskReportSchema.parse(value) as RiskReport
}
