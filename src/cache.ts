import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

/**
 * `record`: read from the cache when an entry exists, otherwise produce it and write it.
 * `replay`: read only. A missing entry is an error, so tests never reach the network.
 */
export type CacheMode = 'record' | 'replay'

export interface Cache {
  memo<T>(key: string, produce: () => Promise<T>): Promise<T>
}

export interface CacheOptions {
  dir?: string
  mode?: CacheMode
  /**
   * Keys that must be read live even when cached (record mode only). Use this for data that
   * changes without its key changing, such as a PR's commits or a repo's releases.
   */
  bypass?: (key: string) => boolean
}

function fileFor(dir: string, key: string): string {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 32)
  return join(dir, `${digest}.json.gz`)
}

export function createCache({ dir, mode = 'record', bypass }: CacheOptions = {}): Cache {
  return {
    async memo<T>(key: string, produce: () => Promise<T>): Promise<T> {
      const file = dir ? fileFor(dir, key) : undefined
      const live = mode === 'record' && bypass?.(key) === true
      if (file && !live && existsSync(file)) {
        const entry = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as {
          key: string
          value: T
        }
        return entry.value
      }
      if (mode === 'replay') {
        throw new Error(`No recorded response for "${key}" (looked in ${dir ?? 'no cache dir'})`)
      }
      const value = await produce()
      if (dir) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(fileFor(dir, key), gzipSync(JSON.stringify({ key, value })))
      }
      return value
    },
  }
}
