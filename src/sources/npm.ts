import type { Cache } from '../cache'
import { readTarGz } from '../tar'

const REGISTRY = 'https://registry.npmjs.org'

export interface Packument {
  name: string
  repository?: string
  versions: Record<string, { tarball: string }>
}

/** Files from a package tarball that the analysis needs, keyed by path inside the package. */
export type PackageFiles = Record<string, string>

export interface NpmSource {
  packument(name: string): Promise<Packument | null>
  tarball(name: string, version: string): Promise<PackageFiles>
}

const DECLARATION = /\.d\.[cm]?ts$/
const CHANGELOG = /^changelog(\.md|\.txt)?$/i

export function keepPackageFile(path: string): boolean {
  if (path === 'package.json') return true
  if (path.includes('node_modules/')) return false
  if (DECLARATION.test(path)) return true
  return !path.includes('/') && CHANGELOG.test(path)
}

function repositoryUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'url' in value) {
    return typeof value.url === 'string' ? value.url : undefined
  }
  return undefined
}

export function createNpmSource(): NpmSource {
  const packument = async (name: string): Promise<Packument | null> => {
    const response = await fetch(`${REGISTRY}/${name.replace('/', '%2F')}`, {
      headers: { accept: 'application/json', 'user-agent': 'frontal-upgrade-risk' },
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`npm registry ${response.status} for ${name}`)
    const raw = (await response.json()) as {
      name: string
      repository?: unknown
      versions?: Record<string, { dist?: { tarball?: string } }>
    }
    // Trim the document to what the analysis reads, so recorded fixtures stay small.
    const versions: Packument['versions'] = {}
    for (const [version, meta] of Object.entries(raw.versions ?? {})) {
      if (meta.dist?.tarball) versions[version] = { tarball: meta.dist.tarball }
    }
    return { name: raw.name, repository: repositoryUrl(raw.repository), versions }
  }

  const tarball = async (name: string, version: string): Promise<PackageFiles> => {
    const tarballUrl = (await packument(name))?.versions[version]?.tarball
    if (!tarballUrl) throw new Error(`No tarball for ${name}@${version}`)
    const response = await fetch(tarballUrl, { headers: { 'user-agent': 'frontal-upgrade-risk' } })
    if (!response.ok) throw new Error(`Tarball download ${response.status} for ${name}@${version}`)
    const archive = new Uint8Array(await response.arrayBuffer())
    return readTarGz(archive, (entry) => {
      const relativePath = entry.startsWith('package/') ? entry.slice('package/'.length) : entry
      return keepPackageFile(relativePath) ? relativePath : undefined
    })
  }

  return { packument, tarball }
}

/** Wraps an npm source so each registry or tarball call is memoized in the cache. */
export function cachedNpm(source: NpmSource, cache: Cache): NpmSource {
  return {
    packument: (name) => cache.memo(`npm:packument:${name}`, () => source.packument(name)),
    tarball: (name, version) =>
      cache.memo(`npm:tarball:${name}@${version}`, () => source.tarball(name, version)),
  }
}
