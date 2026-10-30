import { describe, expect, test } from 'bun:test'
import type { NpmSource, PackageFiles } from '../../src/sources/npm'
import { diffTypes } from '../../src/typediff'

function pkg(version: string, dts: string): PackageFiles {
  return {
    'package.json': JSON.stringify({ name: 'lib', version, types: 'index.d.ts' }),
    'index.d.ts': dts,
  }
}

function fakeNpm(versions: Record<string, PackageFiles>): NpmSource {
  return {
    packument: async () => null,
    tarball: async (_name, version) => {
      const files = versions[version]
      if (!files) throw new Error(`missing ${version}`)
      return files
    },
  }
}

describe('diffTypes', () => {
  test('classifies removed, renamed and signature-changed exports', async () => {
    const npm = fakeNpm({
      '1.0.0': pkg(
        '1.0.0',
        [
          'export declare function parse(input: string): number;',
          'export declare function legacyCheck(value: string): boolean;',
          'export declare function keep(a: number): number;',
          'export interface Options { retries: number; }',
        ].join('\n'),
      ),
      '2.0.0': pkg(
        '2.0.0',
        [
          'export declare function parseValue(input: string): number;',
          'export declare function keep(a: string): number;',
          'export interface Options { retries: number; }',
        ].join('\n'),
      ),
    })
    const result = await diffTypes(npm, 'lib', '1.0.0', '2.0.0')
    expect(result.found).toBe(true)
    const byKind = Object.fromEntries(result.changes.map((c) => [c.symbol, c]))
    expect(byKind.parse?.kind).toBe('renamed')
    expect(byKind.parse?.renamedTo).toBe('parseValue')
    expect(byKind.legacyCheck?.kind).toBe('removed')
    expect(byKind.legacyCheck?.quote).toBe(
      'export declare function legacyCheck(value: string): boolean;',
    )
    expect(byKind.keep?.kind).toBe('signature-changed')
    expect(byKind.Options).toBeUndefined()
  })

  test('reports found=false when neither side has types', async () => {
    const npm = fakeNpm({
      '1.0.0': { 'package.json': '{"name":"lib"}', 'README.md': 'x' },
      '2.0.0': { 'package.json': '{"name":"lib"}' },
    })
    expect(await diffTypes(npm, 'lib', '1.0.0', '2.0.0')).toEqual({ found: false, changes: [] })
  })
})
