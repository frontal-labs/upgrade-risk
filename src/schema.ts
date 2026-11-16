import { z } from "zod";
import { type RiskReport, SCHEMA_ID } from "./types";

const RiskLevel = z.enum(["safe", "review", "unknown", "risky"]);

const Usage = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  snippet: z.string(),
});

const BreakingChange = z.object({
  evidence: z.string(),
  quote: z.string(),
  source: z.enum(["release-notes", "changelog", "type-diff", "llm"]),
  summary: z.string(),
  symbols: z.array(z.string()),
  usages: z.array(Usage),
});

const PackageUpdate = z.object({
  breaking: z.array(BreakingChange),
  from: z.string(),
  name: z.string(),
  notesFound: z.boolean(),
  risk: RiskLevel,
  to: z.string(),
  typesFound: z.boolean(),
});

/** Public output format. Changing it means a new schema version string. */
export const RiskReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  overall: RiskLevel,
  pr: z.number().int().positive(),
  schema: z.literal(SCHEMA_ID),
  updates: z.array(PackageUpdate),
});

export function parseRiskReport(value: unknown): RiskReport {
  return RiskReportSchema.parse(value) as RiskReport;
}
