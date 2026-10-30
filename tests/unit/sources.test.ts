import { describe, expect, test } from 'bun:test'
import { changelogInRange } from '../../src/sources/changelog'
import { githubRepo, releasesInRange, versionFromTag } from '../../src/sources/releases'

describe('release tags', () => {
  test('accepts own tags and rejects other packages in a monorepo', () => {
    expect(versionFromTag('v1.2.3', 'zod')).toBe('1.2.3')
    expect(versionFromTag('zod@1.2.3', 'zod')).toBe('1.2.3')
    expect(versionFromTag('@scope/pkg@2.0.0', '@scope/pkg')).toBe('2.0.0')
    expect(versionFromTag('other@1.2.3', 'zod')).toBeUndefined()
  })

  test('selects releases with from < version <= to', () => {
    const releases = [
      { tag: 'v1.0.0', name: '', body: 'a', url: 'u1', draft: false, prerelease: false },
      { tag: 'v1.1.0', name: '', body: 'b', url: 'u2', draft: false, prerelease: false },
      { tag: 'v2.0.0', name: '', body: 'c', url: 'u3', draft: false, prerelease: false },
      { tag: 'v2.1.0', name: '', body: 'd', url: 'u4', draft: true, prerelease: false },
    ]
    expect(releasesInRange(releases, 'zod', '1.0.0', '2.0.0').map((r) => r.version)).toEqual([
      '1.1.0',
      '2.0.0',
    ])
  })
})

describe('githubRepo', () => {
  test('reads owner/name from npm repository URLs', () => {
    expect(githubRepo('git+https://github.com/colinhacks/zod.git')).toBe('colinhacks/zod')
    expect(githubRepo('github:a/b')).toBeUndefined()
    expect(githubRepo('https://gitlab.com/a/b')).toBeUndefined()
  })
})

describe('changelogInRange', () => {
  test('slices the sections between from and to', () => {
    const md = '# Changelog\n\n## [2.0.0]\n- big\n\n## 1.1.0\n- mid\n\n## 1.0.0\n- old\n'
    const sections = changelogInRange(md, '1.0.0', '2.0.0')
    expect(sections.map((s) => s.version)).toEqual(['2.0.0', '1.1.0'])
    expect(sections[1]?.text).toContain('mid')
  })
})
