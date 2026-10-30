import { posix } from 'node:path'
import semver from 'semver'
import * as ts from 'typescript'
import type { NpmSource, PackageFiles } from './sources/npm'

export type TypeChangeKind = 'removed' | 'renamed' | 'signature-changed'

export interface TypeChange {
  kind: TypeChangeKind
  symbol: string
  /** Old declaration line, copied exactly from the old `.d.ts` file. */
  quote: string
  /** Old file path inside the package, for evidence links. */
  file: string
  renamedTo?: string
}

export interface TypeDiffResult {
  /** True when both versions expose a readable set of exported types. */
  found: boolean
  changes: TypeChange[]
}

interface ExportInfo {
  signature: string
  kind: string
  file: string
  quote: string
}

type ExportMap = Map<string, ExportInfo>

function conditionTypes(value: unknown, depth = 0): string | undefined {
  if (typeof value === 'string') return value.endsWith('.d.ts') ? value : undefined
  if (depth > 3 || typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.types === 'string') return record.types
  for (const key of ['import', 'require', 'default']) {
    const found = conditionTypes(record[key], depth + 1)
    if (found) return found
  }
  return undefined
}

function normalize(path: string): string {
  return posix.normalize(path).replace(/^\.\//, '')
}

/** Declaration entry points per subpath (`.` for the root), keyed to files in the package. */
export function entryPoints(
  files: PackageFiles,
  manifest: Record<string, unknown>,
): Map<string, string> {
  const entries = new Map<string, string>()
  const add = (subpath: string, candidate: string | undefined) => {
    if (!candidate) return
    const path = normalize(candidate)
    if (files[path] !== undefined) entries.set(subpath, path)
  }

  const exportsField = manifest.exports
  const rootFromExports =
    typeof exportsField === 'object' && exportsField !== null && !Array.isArray(exportsField)
      ? (exportsField as Record<string, unknown>)
      : undefined

  if (rootFromExports && Object.keys(rootFromExports).some((key) => key.startsWith('.'))) {
    for (const [key, value] of Object.entries(rootFromExports)) {
      if (!key.startsWith('.')) continue
      add(key === '.' ? '.' : key.slice(2), conditionTypes(value))
    }
  } else if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    add('.', conditionTypes(exportsField))
  }

  const topLevel = [manifest.types, manifest.typings].find(
    (value): value is string => typeof value === 'string',
  )
  const main =
    typeof manifest.main === 'string' ? manifest.main.replace(/\.[cm]?js$/, '.d.ts') : undefined
  if (!entries.has('.')) {
    add('.', topLevel ?? conditionTypes(rootFromExports?.['.']) ?? main ?? 'index.d.ts')
  }
  return entries
}

function memoryHost(files: PackageFiles): ts.CompilerHost {
  const lookup = (fileName: string): string | undefined => files[fileName.replace(/^\//, '')]
  return {
    getSourceFile: (fileName, languageVersion) => {
      const text = lookup(fileName)
      return text === undefined
        ? undefined
        : ts.createSourceFile(fileName, text, languageVersion, true)
    },
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: (fileName) => lookup(fileName) !== undefined,
    readFile: (fileName) => lookup(fileName),
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  }
}

function kindOf(symbol: ts.Symbol): string {
  const f = ts.SymbolFlags
  if (symbol.flags & f.Class) return 'class'
  if (symbol.flags & f.Interface) return 'interface'
  if (symbol.flags & f.Enum) return 'enum'
  if (symbol.flags & f.TypeAlias) return 'type'
  if (symbol.flags & f.Function) return 'function'
  if (symbol.flags & (f.Variable | f.Property)) return 'variable'
  return 'other'
}

/** A stable description of what an exported symbol looks like to a caller. */
function signatureOf(checker: ts.TypeChecker, symbol: ts.Symbol, location: ts.Node): string {
  const f = ts.SymbolFlags
  if (symbol.flags & (f.Class | f.Interface | f.TypeAlias)) {
    const declared = checker.getDeclaredTypeOfSymbol(symbol)
    const members = checker
      .getPropertiesOfType(declared)
      .map((prop) => `${prop.name}:${checker.typeToString(checker.getTypeOfSymbol(prop))}`)
      .sort()
    return `${checker.typeToString(declared, undefined, ts.TypeFormatFlags.NoTruncation)}{${members.join(';')}}`
  }
  return checker.typeToString(
    checker.getTypeOfSymbolAtLocation(symbol, location),
    undefined,
    ts.TypeFormatFlags.NoTruncation,
  )
}

/** Exported symbols of one declaration entry point. */
export function exportsOf(files: PackageFiles, entryPath: string): ExportMap {
  const exports: ExportMap = new Map()
  const rootName = `/${entryPath}`
  const program = ts.createProgram({
    rootNames: [rootName],
    options: {
      noLib: true,
      types: [],
      skipLibCheck: true,
      strict: false,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    host: memoryHost(files),
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(rootName)
  const moduleSymbol = source ? checker.getSymbolAtLocation(source) : undefined
  if (!source || !moduleSymbol) return exports

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const target =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declaration = target.declarations?.[0] ?? exported.declarations?.[0]
    if (!declaration) continue
    const declarationFile = declaration.getSourceFile()
    const line = declarationFile.getLineAndCharacterOfPosition(
      declaration.getStart(declarationFile),
    )
    const rawLine = declarationFile.text.split('\n')[line.line] ?? ''
    exports.set(exported.name, {
      signature: signatureOf(checker, target, declaration),
      kind: kindOf(target),
      file: declarationFile.fileName.replace(/^\//, ''),
      quote: rawLine.trim(),
    })
  }
  return exports
}

function nameSubpath(subpath: string, symbol: string): string {
  return subpath === '.' ? symbol : `${subpath}::${symbol}`
}

async function typesFilesFor(
  npm: NpmSource,
  name: string,
  version: string,
  manifest: Record<string, unknown>,
  files: PackageFiles,
): Promise<{ files: PackageFiles; entries: Map<string, string> }> {
  const own = entryPoints(files, manifest)
  if (own.size > 0) return { files, entries: own }

  // Fall back to the matching @types package, when there is one for this major version.
  const typesName = name.startsWith('@')
    ? `@types/${name.slice(1).replace('/', '__')}`
    : `@types/${name}`
  const packument = await npm.packument(typesName).catch(() => null)
  const major = semver.major(version)
  const typesVersion = Object.keys(packument?.versions ?? {})
    .filter((candidate) => semver.valid(candidate) && semver.major(candidate) === major)
    .sort(semver.rcompare)[0]
  if (!typesVersion) return { files, entries: new Map() }
  const typesFiles = await npm.tarball(typesName, typesVersion).catch(() => null)
  if (!typesFiles) return { files, entries: new Map() }
  const typesManifest = JSON.parse(typesFiles['package.json'] ?? '{}') as Record<string, unknown>
  return { files: typesFiles, entries: entryPoints(typesFiles, typesManifest) }
}

async function exportsForVersion(
  npm: NpmSource,
  name: string,
  version: string,
): Promise<{ exports: Map<string, ExportMap>; files: PackageFiles } | null> {
  const files = await npm.tarball(name, version)
  const manifest = JSON.parse(files['package.json'] ?? '{}') as Record<string, unknown>
  const resolved = await typesFilesFor(npm, name, version, manifest, files)
  if (resolved.entries.size === 0) return null

  const exports = new Map<string, ExportMap>()
  for (const [subpath, path] of resolved.entries) {
    exports.set(subpath, exportsOf(resolved.files, path))
  }
  return { exports, files: resolved.files }
}

/** Compares exported types of two versions and classifies each change. */
export async function diffTypes(
  npm: NpmSource,
  name: string,
  from: string,
  to: string,
): Promise<TypeDiffResult> {
  const before = await exportsForVersion(npm, name, from)
  const after = await exportsForVersion(npm, name, to)
  if (!before || !after) return { found: false, changes: [] }

  const changes: TypeChange[] = []
  for (const [subpath, oldExports] of before.exports) {
    const newExports = after.exports.get(subpath) ?? new Map<string, ExportInfo>()
    const added: Array<[string, ExportInfo]> = [...newExports].filter(
      ([symbol]) => !oldExports.has(symbol),
    )
    const claimed = new Set<string>()

    for (const [symbol, oldInfo] of oldExports) {
      const current = newExports.get(symbol)
      const label = nameSubpath(subpath, symbol)
      if (!current) {
        const rename = added.find(
          ([candidate, info]) =>
            !claimed.has(candidate) &&
            info.kind === oldInfo.kind &&
            info.signature === oldInfo.signature &&
            oldInfo.signature !== '',
        )
        if (rename) {
          claimed.add(rename[0])
          changes.push({
            kind: 'renamed',
            symbol: label,
            quote: oldInfo.quote,
            file: oldInfo.file,
            renamedTo: nameSubpath(subpath, rename[0]),
          })
        } else {
          changes.push({ kind: 'removed', symbol: label, quote: oldInfo.quote, file: oldInfo.file })
        }
      } else if (current.signature !== oldInfo.signature) {
        changes.push({
          kind: 'signature-changed',
          symbol: label,
          quote: oldInfo.quote,
          file: oldInfo.file,
        })
      }
    }
  }
  return { found: true, changes }
}
