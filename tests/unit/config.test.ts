import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderComment } from '../../src/comment'
import { defaultTags, loadTags } from '../../src/config'
import type { RiskReport } from '../../src/types'

const report: RiskReport = {
  schema: 'frontal.upgrade-risk/v1',
  pr: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  overall: 'risky',
  updates: [
    {
      name: 'lib',
      from: '1.0.0',
      to: '2.0.0',
      risk: 'risky',
      notesFound: true,
      typesFound: true,
      breaking: [
        {
          summary: 'x',
          source: 'llm',
          evidence: 'https://e',
          quote: '- x',
          symbols: ['x'],
          usages: [{ file: 'a.ts', line: 2, snippet: 'x()' }],
        },
      ],
    },
  ],
}

describe('tags config', () => {
  test('defaults come from config/tags.json', () => {
    expect(defaultTags.risk.risky.label).toBe('Risky')
    expect(defaultTags.risk.risky.icon).toBe('🔴')
    expect(defaultTags.sources.llm).toBe('🤖 LLM extracted')
  })

  test('an override file renames labels and keeps the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tags-'))
    try {
      const file = join(dir, 'tags.json')
      writeFileSync(
        file,
        JSON.stringify({
          risk: { risky: { label: 'Breaking', icon: '⛔' } },
          headlines: { risky: '{breaking} hit {places}.' },
          sources: { 'type-diff': { label: 'typings' } },
        }),
      )
      const tags = loadTags(file)
      expect(tags.risk.risky.label).toBe('Breaking')
      expect(tags.risk.safe.label).toBe('Safe')
      expect(tags.sources['type-diff']).toBe('typings')
      const md = renderComment(report, { repo: 'a/b', sha: 'h', tags })
      expect(md).toContain('⛔ Breaking')
      expect(md).toContain('1 breaking change hit 1 place.')
      expect(md).toContain('🤖 LLM extracted')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects an override with a non-string label', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tags-'))
    try {
      const file = join(dir, 'bad.json')
      writeFileSync(file, JSON.stringify({ risk: { risky: { label: 3 } } }))
      expect(() => loadTags(file)).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
