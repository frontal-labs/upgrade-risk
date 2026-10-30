import { describe, expect, test } from 'bun:test'
import { gzipSync } from 'node:zlib'
import { readTarGz } from '../../src/tar'

function header(name: string, size: number, type = '0', prefix = ''): Uint8Array {
  const h = new Uint8Array(512)
  const write = (text: string, offset: number) => h.set(new TextEncoder().encode(text), offset)
  write(name, 0)
  write(size.toString(8).padStart(11, '0'), 124)
  write(type, 156)
  write('ustar', 257)
  write(prefix, 345)
  return h
}

function entry(name: string, body: string, prefix = ''): Uint8Array[] {
  const data = new TextEncoder().encode(body)
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
  padded.set(data)
  return [header(name, data.length, '0', prefix), padded]
}

function tar(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0) + 1024
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('readTarGz', () => {
  test('reads selected gzipped entries, including ustar prefixes', () => {
    const archive = gzipSync(
      tar([
        ...entry('package.json', '{"name":"x"}'),
        ...entry('index.d.ts', 'export {}', 'package'),
        ...entry('ignored.js', 'x'),
      ]),
    )
    const files = readTarGz(new Uint8Array(archive), (path) =>
      path.endsWith('.json') || path.endsWith('.d.ts') ? path : undefined,
    )
    expect(files).toEqual({ 'package.json': '{"name":"x"}', 'package/index.d.ts': 'export {}' })
  })
})
