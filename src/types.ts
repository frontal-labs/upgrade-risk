export const SCHEMA_ID = "frontal.upgrade-risk/v1";

export type RiskLevel = "safe" | "review" | "unknown" | "risky";

export type BreakingSource =
  | "release-notes"
  | "changelog"
  | "type-diff"
  | "llm";

export type DepType =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

export interface Usage {
  file: string;
  line: number;
  snippet: string;
}

export interface BreakingChange {
  evidence: string;
  quote: string;
  source: BreakingSource;
  summary: string;
  symbols: string[];
  usages: Usage[];
}

export interface PackageUpdate {
  breaking: BreakingChange[];
  from: string;
  name: string;
  notesFound: boolean;
  risk: RiskLevel;
  to: string;
  typesFound: boolean;
}

export interface RiskReport {
  generatedAt: string;
  overall: RiskLevel;
  pr: number;
  schema: typeof SCHEMA_ID;
  updates: PackageUpdate[];
}

export interface DetectedUpdate {
  depType: DepType;
  from: string;
  name: string;
  to: string;
}

export const RISK_RANK: Record<RiskLevel, number> = {
  review: 2,
  risky: 3,
  safe: 0,
  unknown: 1,
};

export function worstRisk(levels: RiskLevel[]): RiskLevel {
  let worst: RiskLevel = "safe";
  for (const level of levels) {
    if (RISK_RANK[level] > RISK_RANK[worst]) {
      worst = level;
    }
  }
  return worst;
}
