#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzePr } from './analyze'
import { createCache } from './cache'
import { createGitHubSource } from './sources/github'
import { createNpmSource } from './sources/npm'
import type { RiskLevel } from './types'

interface EvalCase {
  id: string
  repo: string
  pr: number
  expected: RiskLevel
  expectedNote: string
  sources: string
  updates: Array<{ name: string; from: string; to: string }>
}

interface EvalResult {
  id: string
  expected: RiskLevel
  actual: RiskLevel | 'error'
  note: string
  error?: string
}

const LEVELS: RiskLevel[] = ['risky', 'review', 'unknown', 'safe']
const FIXTURES = fileURLToPath(new URL('../tests/fixtures', import.meta.url))

function loadCases(dir: string): EvalCase[] {
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .filter((entry) => existsSync(join(dir, entry, 'case.json')))
    .map((entry) => JSON.parse(readFileSync(join(dir, entry, 'case.json'), 'utf8')) as EvalCase)
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function runCase(testCase: EvalCase): Promise<EvalResult> {
  const cache = createCache({ dir: join(FIXTURES, testCase.id, 'cache'), mode: 'replay' })
  try {
    const { report } = await analyzePr({
      repo: testCase.repo,
      pr: testCase.pr,
      github: createGitHubSource(),
      npm: createNpmSource(),
      cache,
      warn: () => undefined,
    })
    return {
      id: testCase.id,
      expected: testCase.expected,
      actual: report.overall,
      note: testCase.expectedNote,
    }
  } catch (error) {
    return {
      id: testCase.id,
      expected: testCase.expected,
      actual: 'error',
      note: testCase.expectedNote,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function printTable(results: EvalResult[]): void {
  console.log('\nConfusion matrix (rows: expected, columns: actual)\n')
  const columns = [...LEVELS, 'error' as const]
  console.log(`${'expected'.padEnd(10)}${columns.map((c) => c.padStart(9)).join('')}   accuracy`)
  for (const expected of LEVELS) {
    const rows = results.filter((result) => result.expected === expected)
    const cells = columns.map((column) =>
      String(rows.filter((result) => result.actual === column).length).padStart(9),
    )
    const correct = rows.filter((result) => result.actual === expected).length
    const accuracy = rows.length === 0 ? 'n/a' : `${correct}/${rows.length}`
    console.log(`${expected.padEnd(10)}${cells.join('')}   ${accuracy}`)
  }
  const total = results.filter((result) => result.actual === result.expected).length
  console.log(`\nOverall accuracy: ${total}/${results.length}`)
}

function printMismatches(results: EvalResult[]): void {
  const mismatches = results.filter((result) => result.actual !== result.expected)
  if (mismatches.length === 0) {
    console.log('\nNo mismatches.')
    return
  }
  console.log(`\nMismatches (${mismatches.length}):`)
  for (const result of mismatches) {
    const detail = result.error ? ` [${result.error}]` : ''
    console.log(`- ${result.id}: expected ${result.expected}, got ${result.actual}${detail}`)
    console.log(`    note: ${result.note}`)
  }
}

async function main(): Promise<void> {
  const cases = loadCases(FIXTURES)
  if (cases.length === 0) {
    console.log(`No labeled cases found in ${FIXTURES}`)
    return
  }
  const results: EvalResult[] = []
  for (const testCase of cases) {
    results.push(await runCase(testCase))
  }

  printTable(results)
  printMismatches(results)

  // A case labeled risky or unknown that comes out safe is the failure this eval exists to catch.
  const falseSafe = results.filter(
    (result) =>
      (result.expected === 'risky' || result.expected === 'unknown') && result.actual === 'safe',
  )
  if (falseSafe.length > 0) {
    console.log(`\nFAIL: ${falseSafe.length} risky/unknown case(s) reported as safe.`)
    process.exitCode = 1
  }
}

await main()
