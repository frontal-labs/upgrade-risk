import { gunzipSync } from 'node:zlib'

export type PathSelector = (entryPath: string) => string | undefined

const decoder = new TextDecoder()

function readString(header: Uint8Array, start: number, length: number): string {
  const slice = header.subarray(start, start + length)
  const end = slice.indexOf(0)
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end))
}

/**
 * Reads a gzipped (or plain) tar archive and returns the text of every regular file
 * that `select` keeps. `select` receives the raw entry path and returns the key to store
 * it under, or undefined to skip the entry. Binary files are skipped by the caller's filter.
 */
export function readTarGz(archive: Uint8Array, select: PathSelector): Record<string, string> {
  const isGzip = archive[0] === 0x1f && archive[1] === 0x8b
  const buffer = isGzip ? gunzipSync(archive) : archive
  const files: Record<string, string> = {}
  let offset = 0
  let longPath: string | undefined

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break

    const size = Number.parseInt(readString(header, 124, 12).trim() || '0', 8)
    const type = String.fromCharCode(header[156] || 48)
    const ustarPrefix = readString(header, 257, 6) === 'ustar' ? readString(header, 345, 155) : ''
    const name = readString(header, 0, 100)
    const entryPath = longPath ?? (ustarPrefix ? `${ustarPrefix}/${name}` : name)
    offset += 512

    const body = buffer.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512

    if (type === 'L') {
      longPath = decoder.decode(body).replace(/\0+$/, '')
      continue
    }
    if (type === 'x') {
      const match = decoder.decode(body).match(/\d+ path=([^\n]+)/)
      longPath = match?.[1]
      continue
    }

    longPath = undefined
    if (type !== '0' && type !== '\0') continue

    const key = select(entryPath)
    if (key !== undefined) files[key] = decoder.decode(body)
  }

  return files
}
