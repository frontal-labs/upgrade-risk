#!/usr/bin/env bun
// Records API responses for labeled candidates into tests/fixtures/<id>/cache.
// Usage: GH_TOKEN=$(gh auth token) bun scripts/record-fixtures.ts <candidates.json>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzePr } from "../src/analyze";
import { createCache } from "../src/cache";
import { env } from "../src/env";
import { createGitHubSource } from "../src/sources/github";
import { createNpmSource } from "../src/sources/npm";
import type { RiskLevel } from "../src/types";

interface Candidate {
  expected: RiskLevel;
  packages: Array<{ name: string; from: string; to: string }>;
  pr: number;
  rationale: string;
  repo: string;
  title: string;
  url: string;
}

const FIXTURES = join(import.meta.dir, "..", "tests", "fixtures");
const candidates = JSON.parse(
  readFileSync(process.argv[2] ?? "", "utf8")
) as Candidate[];
const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;

for (const candidate of candidates) {
  const id =
    `${candidate.repo.replace("/", "-")}-pr${candidate.pr}`.toLowerCase();
  const dir = join(FIXTURES, id);
  mkdirSync(dir, { recursive: true });
  const updates = candidate.packages.map((p) => ({
    from: p.from.split(" ")[0] ?? p.from,
    name: p.name,
    to: p.to.split(" ")[0] ?? p.to,
  }));
  const caseFile = {
    expected: candidate.expected,
    expectedNote: candidate.rationale,
    id,
    pr: candidate.pr,
    repo: candidate.repo,
    sources: candidate.url,
    updates,
  };
  writeFileSync(
    join(dir, "case.json"),
    `${JSON.stringify(caseFile, null, 2)}\n`
  );
  try {
    const { report } = await analyzePr({
      cache: createCache({ dir: join(dir, "cache"), mode: "record" }),
      github: createGitHubSource(token),
      npm: createNpmSource(),
      pr: candidate.pr,
      repo: candidate.repo,
      warn: (message) => console.warn(`  [${id}] ${message}`),
    });
    console.log(`${id}: expected ${candidate.expected}, got ${report.overall}`);
  } catch (error) {
    console.log(
      `${id}: ERROR ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
