import semver from 'semver'
import type { ReleaseInfo } from './github'

export interface ReleaseNote {
  version: string
  url: string
  body: string
}

/** `github.com/owner/repo` from an npm `repository` value, or undefined when it is not GitHub. */
export function githubRepo(url: string | undefined): string | undefined {
  if (!url) return undefined
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?]|$)/)
  return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : undefined
}

const TAG_PREFIX_OK = /^(?:v|release[-_ ]?|version[-_ ]?)?$/i

/**
 * Returns the version a release tag names for `name`, or undefined when the tag belongs to
 * another package in a monorepo (for example `other-pkg@1.2.3`).
 */
export function versionFromTag(tag: string, name: string): string | undefined {
  const match = tag.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)
  if (!match?.[1]) return undefined
  const prefix = tag.slice(0, tag.length - match[1].length)
  const bare = name.replace(/^@/, '').replace('/', '-')
  const ownPrefix =
    TAG_PREFIX_OK.test(prefix) ||
    prefix === `${name}@` ||
    prefix === `${name}-` ||
    prefix === `${name}-v` ||
    prefix === `${bare}-` ||
    prefix === `${bare}-v`
  return ownPrefix && semver.valid(match[1]) ? match[1] : undefined
}

/** GitHub releases for `name` with from < version <= to, skipping drafts. */
export function releasesInRange(
  releases: ReleaseInfo[],
  name: string,
  from: string,
  to: string,
): ReleaseNote[] {
  const notes: ReleaseNote[] = []
  for (const release of releases) {
    if (release.draft) continue
    const version = versionFromTag(release.tag, name)
    if (!version) continue
    if (semver.gt(version, from) && semver.lte(version, to)) {
      notes.push({ version, url: release.url, body: release.body })
    }
  }
  return notes.sort((a, b) => semver.compare(a.version, b.version))
}
