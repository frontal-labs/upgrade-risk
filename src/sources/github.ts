import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Octokit } from '@octokit/rest'
import type { Cache } from '../cache'
import { readTarGz } from '../tar'

export interface PullInfo {
  number: number
  title: string
  author: string
  baseSha: string
  headSha: string
}

export interface ReleaseInfo {
  tag: string
  name: string
  body: string
  url: string
  draft: boolean
  prerelease: boolean
}

/** Repo-relative path to file text. */
export type SourceFiles = Record<string, string>

export interface GitHubSource {
  getPull(repo: string, pr: number): Promise<PullInfo>
  listPullFiles(repo: string, pr: number): Promise<string[]>
  getFile(repo: string, ref: string, path: string): Promise<string | null>
  listReleases(repo: string): Promise<ReleaseInfo[]>
  /** Source files at `ref` whose text mentions at least one of `names`. */
  sourceFiles(repo: string, ref: string, names: string[]): Promise<SourceFiles>
}

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/
const MAX_FILE_BYTES = 1_000_000

export function isSourcePath(path: string): boolean {
  return SOURCE_EXTENSIONS.test(path) && !path.split('/').includes('node_modules')
}

function keepMentioning(files: SourceFiles, names: string[]): SourceFiles {
  const out: SourceFiles = {}
  for (const [path, text] of Object.entries(files)) {
    if (text.length <= MAX_FILE_BYTES && names.some((name) => text.includes(name))) {
      out[path] = text
    }
  }
  return out
}

export function createGitHubSource(token?: string): GitHubSource {
  const octokit = new Octokit({ auth: token })

  return {
    async getPull(repo, pr) {
      const [owner, name] = splitRepo(repo)
      const { data } = await octokit.pulls.get({ owner, repo: name, pull_number: pr })
      return {
        number: data.number,
        title: data.title,
        author: data.user?.login ?? '',
        baseSha: data.base.sha,
        headSha: data.head.sha,
      }
    },

    async listPullFiles(repo, pr) {
      const [owner, name] = splitRepo(repo)
      const files = await octokit.paginate(octokit.pulls.listFiles, {
        owner,
        repo: name,
        pull_number: pr,
        per_page: 100,
      })
      return files.map((file) => file.filename)
    },

    async getFile(repo, ref, path) {
      const [owner, name] = splitRepo(repo)
      try {
        const { data } = await octokit.repos.getContent({ owner, repo: name, path, ref })
        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null
        return Buffer.from(data.content, 'base64').toString('utf8')
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },

    async listReleases(repo) {
      const [owner, name] = splitRepo(repo)
      let releases: Awaited<ReturnType<typeof octokit.repos.listReleases>>['data']
      try {
        releases = await octokit.paginate(octokit.repos.listReleases, {
          owner,
          repo: name,
          per_page: 100,
        })
      } catch (error) {
        // A repository that was renamed or deleted has no releases to read.
        if (isNotFound(error)) return []
        throw error
      }
      return releases.map((release) => ({
        tag: release.tag_name,
        name: release.name ?? '',
        body: release.body ?? '',
        url: release.html_url,
        draft: release.draft,
        prerelease: release.prerelease,
      }))
    },

    async sourceFiles(repo, ref, names) {
      const [owner, name] = splitRepo(repo)
      const { data } = await octokit.repos.downloadTarballArchive({ owner, repo: name, ref })
      const files = readTarGz(new Uint8Array(data as ArrayBuffer), (entry) => {
        const relativePath = entry.slice(entry.indexOf('/') + 1)
        return isSourcePath(relativePath) ? relativePath : undefined
      })
      return keepMentioning(files, names)
    },
  }
}

/** Reads source files from a local checkout instead of GitHub. */
export function workspaceSourceFiles(dir: string, names: string[]): SourceFiles {
  const files: SourceFiles = {}
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry === '.git') continue
      const full = join(current, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else {
        const rel = relative(dir, full).split(sep).join('/')
        if (isSourcePath(rel)) files[rel] = readFileSync(full, 'utf8')
      }
    }
  }
  walk(dir)
  return keepMentioning(files, names)
}

/** Wraps a GitHub source so every call is memoized in the cache. */
export function cachedGitHub(source: GitHubSource, cache: Cache): GitHubSource {
  return {
    getPull: (repo, pr) => cache.memo(`gh:pull:${repo}#${pr}`, () => source.getPull(repo, pr)),
    listPullFiles: (repo, pr) =>
      cache.memo(`gh:pull-files:${repo}#${pr}`, () => source.listPullFiles(repo, pr)),
    getFile: (repo, ref, path) =>
      cache.memo(`gh:file:${repo}@${ref}:${path}`, () => source.getFile(repo, ref, path)),
    listReleases: (repo) => cache.memo(`gh:releases:${repo}`, () => source.listReleases(repo)),
    sourceFiles: (repo, ref, names) => {
      const sorted = [...names].sort()
      return cache.memo(`gh:sources:${repo}@${ref}:${sorted.join(',')}`, () =>
        source.sourceFiles(repo, ref, sorted),
      )
    },
  }
}

function splitRepo(repo: string): [string, string] {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`Repository must be owner/name, got "${repo}"`)
  return [owner, name]
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}
