import semver from 'semver'
import type { DepType, DetectedUpdate } from './types'

export const LOCKFILES = ['package-lock.json', 'bun.lock', 'pnpm-lock.yaml'] as const

const DEP_TYPES: DepType[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

type Manifest = Partial<Record<DepType, Record<string, string>>>

export type LockVersions = Map<string, string>

/** Parses JSON, treating empty or malformed files as absent instead of failing the analysis. */
function parseJson(text: string | null): unknown {
  if (text === null || text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseManifest(text: string | null): Manifest {
  const parsed = parseJson(text)
  return typeof parsed === 'object' && parsed !== null ? (parsed as Manifest) : {}
}

/** Lockfile versions by package name. Supports npm, bun (text lockfile) and pnpm v9 lockfiles. */
export function parseLockfile(path: string, text: string | null): LockVersions {
  const versions: LockVersions = new Map()
  if (text === null) return versions

  if (path === 'package-lock.json') {
    const lock = parseJson(text) as { packages?: Record<string, { version?: string }> } | null
    for (const [key, meta] of Object.entries(lock?.packages ?? {})) {
      const marker = 'node_modules/'
      const at = key.lastIndexOf(marker)
      if (at === -1 || !meta.version) continue
      versions.set(key.slice(at + marker.length), meta.version)
    }
    return versions
  }

  if (path === 'bun.lock') {
    // bun.lock is JSONC: it allows trailing commas.
    const lock = parseJson(text.replace(/,\s*([}\]])/g, '$1')) as {
      packages?: Record<string, unknown[]>
    } | null
    for (const [name, entry] of Object.entries(lock?.packages ?? {})) {
      const ident = typeof entry[0] === 'string' ? entry[0] : ''
      const at = ident.lastIndexOf('@')
      if (at > 0) versions.set(name, ident.slice(at + 1))
    }
    return versions
  }

  if (path === 'pnpm-lock.yaml') {
    const packages = text.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? ''
    for (const match of packages.matchAll(
      /^ {2}'?\/?((?:@[^/\s']+\/)?[^@\s'/]+)@([^(:'\s]+)'?:/gm,
    )) {
      const [, name, version] = match
      if (name && version && !versions.has(name)) versions.set(name, version)
    }
  }
  return versions
}

function resolveVersion(range: string, locked: string | undefined): string | undefined {
  if (locked && semver.valid(locked)) return locked
  try {
    return semver.minVersion(range)?.version
  } catch {
    // Git URLs, tags such as "latest", and other non-semver ranges cannot be compared.
    return undefined
  }
}

/**
 * Compares package.json at base and head and returns every direct dependency whose
 * version changed. Versions come from the lockfile when present, otherwise from the
 * lowest version allowed by the range.
 */
export function detectUpdates(input: {
  baseManifest: string | null
  headManifest: string | null
  baseLock?: Partial<Record<(typeof LOCKFILES)[number], string | null>>
  headLock?: Partial<Record<(typeof LOCKFILES)[number], string | null>>
}): DetectedUpdate[] {
  const base = parseManifest(input.baseManifest)
  const head = parseManifest(input.headManifest)
  const baseVersions = new Map<string, string>()
  const headVersions = new Map<string, string>()
  for (const path of LOCKFILES) {
    for (const [name, version] of parseLockfile(path, input.baseLock?.[path] ?? null)) {
      if (!baseVersions.has(name)) baseVersions.set(name, version)
    }
    for (const [name, version] of parseLockfile(path, input.headLock?.[path] ?? null)) {
      if (!headVersions.has(name)) headVersions.set(name, version)
    }
  }

  const updates: DetectedUpdate[] = []
  const seen = new Set<string>()
  for (const depType of DEP_TYPES) {
    const headDeps = head[depType] ?? {}
    const baseDeps = base[depType] ?? {}
    for (const [name, toRange] of Object.entries(headDeps)) {
      const fromRange = baseDeps[name]
      if (fromRange === undefined || fromRange === toRange || seen.has(name)) continue
      const from = resolveVersion(fromRange, baseVersions.get(name))
      const to = resolveVersion(toRange, headVersions.get(name))
      if (!from || !to || semver.eq(from, to)) continue
      seen.add(name)
      updates.push({ name, from, to, depType })
    }
  }
  return updates
}
