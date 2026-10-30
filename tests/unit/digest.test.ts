import { describe, expect, test } from 'bun:test'
import { defaultTags } from '../../src/config'
import { type DigestEntry, buildSlackPayload, rankEntries } from '../../src/digest'

const entries: DigestEntry[] = [
  { number: 5, title: 'Bump a', url: 'https://github.com/o/r/pull/5', overall: 'safe' },
  { number: 9, title: 'Bump b', url: 'https://github.com/o/r/pull/9', overall: 'risky' },
  { number: 2, title: 'Bump c', url: 'https://github.com/o/r/pull/2', overall: 'review' },
  { number: 7, title: 'Bump d', url: 'https://github.com/o/r/pull/7', overall: 'risky' },
]

describe('digest', () => {
  test('ranks risky, then review, unknown, safe; older PRs first within a level', () => {
    expect(rankEntries(entries).map((e) => e.number)).toEqual([7, 9, 2, 5])
  })

  test('builds a top-issues style Slack payload', () => {
    const payload = buildSlackPayload(entries, defaultTags, 2)
    expect(payload.prelude).toBe(
      '4 open dependency update PRs: 2 risky, 1 review, 0 unknown, 1 safe.',
    )
    expect(payload.item1URL).toBe('https://github.com/o/r/pull/7')
    expect(payload.item1Text).toBe('🔴 Risky · #7 Bump d')
    expect(payload.item3URL).toBeUndefined()
  })

  test('says so when there are no PRs', () => {
    expect(buildSlackPayload([], defaultTags, 5)).toEqual({
      prelude: 'No open dependency update PRs.',
    })
  })
})
