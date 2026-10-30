import semver from 'semver'

export interface ChangelogSection {
  version: string
  text: string
}

const VERSION_HEADING = /^#{1,3}\s*\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s|$)/

/** Changelog sections whose version satisfies from < version <= to. */
export function changelogInRange(markdown: string, from: string, to: string): ChangelogSection[] {
  const sections: ChangelogSection[] = []
  let current: { version: string; lines: string[] } | undefined

  const flush = () => {
    if (!current) return
    if (semver.gt(current.version, from) && semver.lte(current.version, to)) {
      sections.push({ version: current.version, text: current.lines.join('\n') })
    }
    current = undefined
  }

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(VERSION_HEADING)
    if (heading?.[1] && semver.valid(heading[1])) {
      flush()
      current = { version: heading[1], lines: [] }
    } else if (/^#{1,3}\s/.test(line)) {
      flush()
    } else if (current) {
      current.lines.push(line)
    }
  }
  flush()
  return sections
}

/** Root-level changelog file in a package tarball, if there is one. */
export function findChangelog(files: Record<string, string>): string | undefined {
  const key = Object.keys(files).find((path) => /^changelog(\.md|\.txt)?$/i.test(path))
  return key ? files[key] : undefined
}
