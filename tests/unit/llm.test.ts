import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzePr } from '../../src/analyze'
import { createCache } from '../../src/cache'
import { type Complete, extractWithLlm, parseItems, verifyItems } from '../../src/llm'
import type { GitHubSource } from '../../src/sources/github'
import type { NpmSource } from '../../src/sources/npm'

const notes = {
  source: 'changelog' as const,
  evidence: 'https://e',
  text: 'Some intro.\n- `configure` now takes an options object\n- Improved speed\n',
}

describe('verifyItems', () => {
  test('drops quotes that are not verbatim lines of the notes', () => {
    const items = verifyItems(
      [
        {
          summary: 'a',
          quote: '- `configure` now takes an options object',
          symbols: ['configure', 'other'],
        },
        { summary: 'invented', quote: 'This line never appeared', symbols: [] },
      ],
      notes,
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.source).toBe('llm')
    expect(items[0]?.symbols).toEqual(['configure'])
  })
})

describe('parseItems', () => {
  test('reads JSON wrapped in prose and ignores malformed replies', () => {
    expect(
      parseItems('Sure! {"items":[{"summary":"s","quote":"q","symbols":["x"]}]} done'),
    ).toEqual([{ summary: 's', quote: 'q', symbols: ['x'] }])
    expect(parseItems('not json')).toEqual([])
  })
})

describe('extractWithLlm', () => {
  test('memoizes the reply by content hash', async () => {
    let calls = 0
    const complete: Complete = async () => {
      calls++
      return '{"items":[]}'
    }
    const cache = createCache()
    await extractWithLlm([notes], { complete, model: 'm', cache })
    await extractWithLlm([notes], { complete, model: 'm', cache })
    expect(calls).toBe(2) // the in-memory cache has no dir, so it does not persist
    const dir = mkdtempSync(join(tmpdir(), 'llm-'))
    const persisted = createCache({ dir })
    calls = 0
    await extractWithLlm([notes], { complete, model: 'm', cache: persisted })
    await extractWithLlm([notes], { complete, model: 'm', cache: persisted })
    expect(calls).toBe(1)
  })
})

describe('analyzePr with LLM', () => {
  const github: GitHubSource = {
    async getPull() {
      return { number: 3, title: 't', author: 'dependabot[bot]', baseSha: 'b', headSha: 'h' }
    },
    async listPullFiles() {
      return ['package.json']
    },
    async getFile(_r, ref, path) {
      if (path !== 'package.json') return null
      return JSON.stringify({ dependencies: { lib: ref === 'b' ? '^1.0.0' : '^2.0.0' } })
    },
    async listReleases() {
      return [
        {
          tag: 'v2.0.0',
          name: '',
          body: 'Changes:\n- `configure` now takes an options object\n',
          url: 'https://gh/r',
          draft: false,
          prerelease: false,
        },
      ]
    },
    async sourceFiles() {
      return { 'src/app.ts': "import { configure } from 'lib'\nconfigure({})\n" }
    },
  }
  const npm: NpmSource = {
    async packument() {
      return { name: 'lib', repository: 'https://github.com/acme/lib', versions: {} }
    },
    async tarball() {
      return { 'package.json': '{"name":"lib"}' }
    },
  }

  test('an LLM-found change used by the repo raises the level to risky', async () => {
    const complete: Complete = async () =>
      '{"items":[{"summary":"configure takes options","quote":"- `configure` now takes an options object","symbols":["configure"]}]}'
    const { report } = await analyzePr({
      repo: 'a/b',
      pr: 3,
      github,
      npm,
      cache: createCache(),
      llm: { complete, model: 'm', cache: createCache() },
      warn: () => undefined,
    })
    expect(report.overall).toBe('risky')
    const change = report.updates[0]?.breaking[0]
    expect(change?.source).toBe('llm')
  })

  test('without the LLM, the same notes give review (prose only)', async () => {
    const { report } = await analyzePr({ repo: 'a/b', pr: 3, github, npm, cache: createCache() })
    // The note line has no rule keyword, so the rules find nothing; the major bump with notes
    // but no type diff is partial evidence, which is review.
    expect(report.overall).toBe('review')
  })
})
