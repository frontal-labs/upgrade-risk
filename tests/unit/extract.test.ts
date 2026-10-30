import { describe, expect, test } from 'bun:test'
import { extractBreaking, extractSymbols } from '../../src/extract'

describe('extractBreaking', () => {
  test('keeps the exact source line and symbols from keyword lines', () => {
    const items = extractBreaking([
      {
        source: 'release-notes',
        evidence: 'https://example.com/r/1',
        text: '## Changes\n- Added `parse` helper\n- BREAKING: `z.string().email()` was removed\n',
      },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.quote).toBe('- BREAKING: `z.string().email()` was removed')
    expect(items[0]?.symbols).toContain('email')
    expect(items[0]?.source).toBe('release-notes')
  })

  test('treats every bullet under a Breaking heading as breaking', () => {
    const items = extractBreaking([
      {
        source: 'changelog',
        evidence: 'x',
        text: '### Breaking changes\n- Node 18 is no longer supported\n- Config moved\n### Fixes\n- Fixed bug\n',
      },
    ])
    expect(items.map((item) => item.quote)).toEqual([
      '- Node 18 is no longer supported',
      '- Config moved',
    ])
  })

  test('prose-only items have no symbols', () => {
    const items = extractBreaking([
      { source: 'release-notes', evidence: 'x', text: 'Requires Node 20 or newer now.' },
    ])
    expect(items[0]?.symbols).toEqual([])
  })
})

describe('extractSymbols', () => {
  test('reads backticked identifiers and bare camelCase or call names', () => {
    expect(extractSymbols('`parseDate` was renamed, use toDate() instead')).toEqual(
      expect.arrayContaining(['parseDate', 'toDate']),
    )
  })
})
