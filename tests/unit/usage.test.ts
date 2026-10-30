import { describe, expect, test } from 'bun:test'
import { findUsages } from '../../src/usage'

const files = {
  'src/a.ts': [
    "import { parse, format } from 'lib'",
    'export const x = parse("1")',
    'const y = format(2)',
  ].join('\n'),
  'src/b.ts': ["import * as lib from 'lib/sub'", 'lib.legacyCheck("a")', 'lib.other()'].join('\n'),
  'src/c.ts': "const { legacyCheck } = require('lib')\nconsole.log(legacyCheck)",
  'src/d.ts': 'const parse = (s: string) => s\nparse("local")',
  'src/unrelated.ts': 'export const parse = 1',
}

describe('findUsages', () => {
  test('finds named imports, namespace members and require destructuring', () => {
    const hits = findUsages(files, 'lib', ['parse', 'legacyCheck'])
    const locations = hits.map((h) => `${h.file}:${h.line}:${h.symbol}`)
    expect(locations).toEqual(
      expect.arrayContaining([
        'src/a.ts:1:parse',
        'src/a.ts:2:parse',
        'src/b.ts:2:legacyCheck',
        'src/c.ts:1:legacyCheck',
      ]),
    )
  })

  test('ignores files that do not mention the package', () => {
    const hits = findUsages(files, 'lib', ['parse'])
    expect(hits.some((h) => h.file === 'src/unrelated.ts')).toBe(false)
  })

  test('does not treat a local function of the same name as a package use', () => {
    const hits = findUsages({ 'src/e.ts': 'const parse = 1\nparse' }, 'lib', ['parse'])
    expect(hits).toEqual([])
  })

  test('returns nothing when no symbols are given', () => {
    expect(findUsages(files, 'lib', [])).toEqual([])
  })
})
