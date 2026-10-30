import { describe, expect, test } from 'bun:test'
import { bumpKind, scoreUpdate } from '../../src/score'
import type { BreakingChange } from '../../src/types'

const used: BreakingChange = {
  summary: 's',
  source: 'type-diff',
  evidence: 'e',
  quote: 'q',
  symbols: ['foo'],
  usages: [{ file: 'src/a.ts', line: 3, snippet: 'foo()' }],
}
const unused: BreakingChange = { ...used, usages: [] }
const prose: BreakingChange = { ...used, symbols: [], usages: [] }
const base = {
  from: '1.0.0',
  to: '2.0.0',
  breaking: [] as BreakingChange[],
  notesFound: false,
  typesFound: false,
}

describe('scoreUpdate', () => {
  test('risky when a breaking symbol is used', () => {
    expect(scoreUpdate({ ...base, breaking: [used], notesFound: true })).toBe('risky')
  })
  test('review for prose-only breaking changes', () => {
    expect(scoreUpdate({ ...base, breaking: [prose], notesFound: true })).toBe('review')
  })
  test('safe when breaking symbols exist but none are used', () => {
    expect(scoreUpdate({ ...base, breaking: [unused], notesFound: true })).toBe('safe')
  })
  test('unknown without notes or types, even for a patch', () => {
    expect(scoreUpdate({ ...base, from: '1.0.0', to: '1.0.1' })).toBe('unknown')
  })
  test('safe for a patch or minor with evidence and no breaking changes', () => {
    expect(scoreUpdate({ ...base, to: '1.1.0', typesFound: true })).toBe('safe')
    expect(scoreUpdate({ ...base, to: '1.0.1', notesFound: true })).toBe('safe')
  })
  test('major needs both notes and types to be safe', () => {
    expect(scoreUpdate({ ...base, notesFound: true, typesFound: true })).toBe('safe')
    expect(scoreUpdate({ ...base, notesFound: true })).toBe('review')
  })
  test('0.x minor bumps count as major', () => {
    expect(bumpKind('0.2.0', '0.3.0')).toBe('major')
    expect(bumpKind('1.2.0', '1.3.0')).toBe('minor')
  })
})
