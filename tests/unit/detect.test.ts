import { describe, expect, test } from 'bun:test'
import { detectUpdates, parseLockfile } from '../../src/detect'

const base = JSON.stringify({ dependencies: { zod: '^3.23.8', react: '^18.0.0', left: '1.0.0' } })
const head = JSON.stringify({ dependencies: { zod: '^4.0.0', react: '^18.0.0', left: '1.0.0' } })

describe('detectUpdates', () => {
  test('finds changed direct dependencies, resolving from the lockfile when present', () => {
    const lock = JSON.stringify({
      packages: {
        'node_modules/zod': { version: '3.23.8' },
        'node_modules/react': { version: '18.3.1' },
      },
    })
    const updates = detectUpdates({
      baseManifest: base,
      headManifest: head,
      baseLock: { 'package-lock.json': lock },
      headLock: {
        'package-lock.json': JSON.stringify({
          packages: { 'node_modules/zod': { version: '4.0.0' } },
        }),
      },
    })
    expect(updates).toEqual([{ name: 'zod', from: '3.23.8', to: '4.0.0', depType: 'dependencies' }])
  })

  test('falls back to the lowest version in the range without a lockfile', () => {
    const updates = detectUpdates({ baseManifest: base, headManifest: head })
    expect(updates).toEqual([{ name: 'zod', from: '3.23.8', to: '4.0.0', depType: 'dependencies' }])
  })

  test('supports grouped updates across dependency types', () => {
    const b = JSON.stringify({ dependencies: { a: '1.0.0' }, devDependencies: { b: '2.0.0' } })
    const h = JSON.stringify({ dependencies: { a: '1.1.0' }, devDependencies: { b: '3.0.0' } })
    const names = detectUpdates({ baseManifest: b, headManifest: h }).map((u) => [
      u.name,
      u.depType,
    ])
    expect(names).toEqual([
      ['a', 'dependencies'],
      ['b', 'devDependencies'],
    ])
  })

  test('skips non-semver ranges', () => {
    const b = JSON.stringify({ dependencies: { git: 'github:a/b' } })
    const h = JSON.stringify({ dependencies: { git: 'github:a/c' } })
    expect(detectUpdates({ baseManifest: b, headManifest: h })).toEqual([])
  })

  test('parses bun.lock with trailing commas', () => {
    const text = '{\n  "packages": {\n    "zod": ["zod@3.23.8", "", {},],\n  },\n}'
    expect(parseLockfile('bun.lock', text).get('zod')).toBe('3.23.8')
  })

  test('parses pnpm lockfile keys', () => {
    const text =
      "lockfileVersion: '9.0'\n\npackages:\n\n  zod@3.23.8:\n    resolution: {}\n\n  '@scope/x@1.2.0':\n    resolution: {}\n\nsnapshots:\n"
    const versions = parseLockfile('pnpm-lock.yaml', text)
    expect(versions.get('zod')).toBe('3.23.8')
    expect(versions.get('@scope/x')).toBe('1.2.0')
  })
})
