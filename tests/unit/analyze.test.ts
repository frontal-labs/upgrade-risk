import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzePr } from '../../src/analyze'
import { createCache } from '../../src/cache'
import type { GitHubSource } from '../../src/sources/github'
import type { NpmSource, PackageFiles } from '../../src/sources/npm'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const v1Types = 'export declare function parse(input: string): number;\n'
const v2Types = 'export declare function parseValue(input: string): number;\n'

const manifest = (range: string) => JSON.stringify({ dependencies: { lib: range } })
const lock = (version: string) => JSON.stringify({ packages: { 'node_modules/lib': { version } } })

function fakeGitHub(overrides: { app?: string; releases?: unknown[] } = {}): GitHubSource {
  const files: Record<string, Record<string, string | null>> = {
    b1: { 'package.json': manifest('^1.0.0'), 'package-lock.json': lock('1.0.0') },
    h1: { 'package.json': manifest('^2.0.0'), 'package-lock.json': lock('2.0.0') },
  }
  return {
    async getPull(repo, pr) {
      return {
        number: pr,
        title: 'Bump lib',
        author: 'dependabot[bot]',
        baseSha: 'b1',
        headSha: 'h1',
      }
    },
    async listPullFiles() {
      return ['package.json', 'package-lock.json']
    },
    async getFile(_repo, ref, path) {
      return files[ref]?.[path] ?? null
    },
    async listReleases() {
      return (overrides.releases ?? [
        {
          tag: 'v2.0.0',
          name: 'v2',
          body: '## Breaking changes\n- `parse` was removed, use `parseValue` instead\n',
          url: 'https://github.com/acme/lib/releases/tag/v2.0.0',
          draft: false,
          prerelease: false,
        },
      ]) as never
    },
    async sourceFiles() {
      return overrides.app === undefined
        ? { 'src/app.ts': "import { parse } from 'lib'\nparse('x')\n" }
        : { 'src/app.ts': overrides.app }
    },
  }
}

const fakeNpm: NpmSource = {
  async packument() {
    return {
      name: 'lib',
      repository: 'git+https://github.com/acme/lib.git',
      versions: { '1.0.0': { tarball: 'a' }, '2.0.0': { tarball: 'b' } },
    }
  },
  async tarball(_name, version): Promise<PackageFiles> {
    const types = version === '1.0.0' ? v1Types : v2Types
    return {
      'package.json': JSON.stringify({ name: 'lib', types: 'index.d.ts' }),
      'index.d.ts': types,
    }
  },
}

const never = (): never => {
  throw new Error('network must not be used on replay')
}

describe('analyzePr', () => {
  test('risky when a removed symbol is imported by the repo', async () => {
    const { report, headSha } = await analyzePr({
      repo: 'acme/app',
      pr: 7,
      github: fakeGitHub(),
      npm: fakeNpm,
      cache: createCache(),
      now: new Date('2026-01-01T00:00:00Z'),
    })
    expect(headSha).toBe('h1')
    expect(report.overall).toBe('risky')
    expect(report.schema).toBe('frontal.upgrade-risk/v1')
    const [update] = report.updates
    expect(update).toMatchObject({ name: 'lib', from: '1.0.0', to: '2.0.0', risk: 'risky' })
    const usageLines = update?.breaking.flatMap((b) => b.usages.map((u) => u.line))
    expect(usageLines).toEqual(expect.arrayContaining([1, 2]))
  })

  test('safe when the removed symbol is not used', async () => {
    const { report } = await analyzePr({
      repo: 'acme/app',
      pr: 8,
      github: fakeGitHub({ app: "import { other } from 'lib'\n" }),
      npm: fakeNpm,
      cache: createCache(),
    })
    expect(report.overall).toBe('safe')
    expect(report.updates[0]?.notesFound).toBe(true)
    expect(report.updates[0]?.typesFound).toBe(true)
  })

  test('unknown when there are no notes, no changelog and no types', async () => {
    const npm: NpmSource = {
      packument: fakeNpm.packument,
      async tarball() {
        return { 'package.json': '{"name":"lib"}' }
      },
    }
    const { report } = await analyzePr({
      repo: 'acme/app',
      pr: 9,
      github: fakeGitHub({ releases: [] }),
      npm,
      cache: createCache(),
      warn: () => undefined,
    })
    expect(report.overall).toBe('unknown')
    expect(report.updates[0]?.notesFound).toBe(false)
  })

  test('replays a recorded run without touching the network', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'upgrade-risk-'))
    dirs.push(dir)
    const recorded = await analyzePr({
      repo: 'acme/app',
      pr: 10,
      github: fakeGitHub(),
      npm: fakeNpm,
      cache: createCache({ dir, mode: 'record' }),
      now: new Date('2026-01-01T00:00:00Z'),
    })
    const replayed = await analyzePr({
      repo: 'acme/app',
      pr: 10,
      github: {
        getPull: never,
        listPullFiles: never,
        getFile: never,
        listReleases: never,
        sourceFiles: never,
      },
      npm: { packument: never, tarball: never },
      cache: createCache({ dir, mode: 'replay' }),
      now: new Date('2026-01-01T00:00:00Z'),
    })
    expect(replayed.report).toEqual(recorded.report)
  })
})
