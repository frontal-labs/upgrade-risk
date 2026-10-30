import { extname } from 'node:path'
import * as ts from 'typescript'

export interface Hit {
  file: string
  line: number
  column: number
  snippet: string
  symbol: string
}

function scriptKind(file: string): ts.ScriptKind {
  switch (extname(file)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

/**
 * Finds where the repo uses any of `symbols` from package `pkg`. Only files that mention the
 * package are parsed. A symbol is used when it is imported by name (including the import
 * itself), read as a member of a namespace or require() result, or accessed as a property
 * of anything in a file that imports the package. The last rule is deliberately broad:
 * when evidence is unclear, the tool reports the higher risk.
 */
export function findUsages(files: Record<string, string>, pkg: string, symbols: string[]): Hit[] {
  const wanted = new Set(symbols)
  if (wanted.size === 0) return []
  const hits: Hit[] = []
  const seen = new Set<string>()

  const isPkg = (specifier: string) => specifier === pkg || specifier.startsWith(`${pkg}/`)

  for (const [file, text] of Object.entries(files)) {
    if (!text.includes(pkg)) continue
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file))
    const lines = text.split('\n')
    const bindings = new Map<string, string>() // local name -> imported name
    const namespaces = new Set<string>()
    let importsPkg = false

    const record = (node: ts.Node, symbol: string) => {
      if (!wanted.has(symbol)) return
      const position = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      const key = `${file}:${position.line}:${symbol}`
      if (seen.has(key)) return
      seen.add(key)
      hits.push({
        file,
        line: position.line + 1,
        column: position.character + 1,
        snippet: (lines[position.line] ?? '').trim().slice(0, 200),
        symbol,
      })
    }

    // Pass 1: learn what the file imports from the package.
    const collect = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (isPkg(node.moduleSpecifier.text)) {
          importsPkg = true
          const clause = node.importClause
          if (clause?.name) bindings.set(clause.name.text, 'default')
          const named = clause?.namedBindings
          if (named && ts.isNamespaceImport(named)) namespaces.add(named.name.text)
          if (named && ts.isNamedImports(named)) {
            for (const element of named.elements) {
              const imported = (element.propertyName ?? element.name).text
              bindings.set(element.name.text, imported)
              record(element.propertyName ?? element.name, imported)
            }
          }
        }
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        if (ts.isStringLiteral(node.moduleSpecifier) && isPkg(node.moduleSpecifier.text)) {
          importsPkg = true
          const named = node.exportClause
          if (named && ts.isNamedExports(named)) {
            for (const element of named.elements) {
              const original = element.propertyName ?? element.name
              record(original, original.text)
            }
          }
        }
      } else if (ts.isImportEqualsDeclaration(node)) {
        const ref = node.moduleReference
        if (
          ts.isExternalModuleReference(ref) &&
          ts.isStringLiteral(ref.expression) &&
          isPkg(ref.expression.text)
        ) {
          importsPkg = true
          namespaces.add(node.name.text)
        }
      } else if (ts.isVariableDeclaration(node) && node.initializer) {
        const call = node.initializer
        const arg = ts.isCallExpression(call) ? call.arguments[0] : undefined
        if (
          ts.isCallExpression(call) &&
          ts.isIdentifier(call.expression) &&
          call.expression.text === 'require' &&
          arg &&
          ts.isStringLiteral(arg) &&
          isPkg(arg.text)
        ) {
          importsPkg = true
          if (ts.isIdentifier(node.name)) {
            namespaces.add(node.name.text)
          } else {
            for (const element of node.name.elements) {
              if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) continue
              const imported = element.propertyName ?? element.name
              const importedName = ts.isIdentifier(imported) ? imported.text : element.name.text
              bindings.set(element.name.text, importedName)
              record(imported, importedName)
            }
          }
        }
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const [arg] = node.arguments
        if (arg && ts.isStringLiteral(arg) && isPkg(arg.text)) importsPkg = true
      }
      ts.forEachChild(node, collect)
    }
    collect(sf)

    // Pass 2: find uses of the bound names and of member accesses.
    const uses = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const parent = node.parent
        const isMemberName = ts.isPropertyAccessExpression(parent) && parent.name === node
        const bound = bindings.get(node.text)
        if (bound !== undefined && !isMemberName && !ts.isImportSpecifier(parent)) {
          record(node, bound)
        }
        if (
          namespaces.has(node.text) &&
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node
        ) {
          record(parent.name, parent.name.text)
        }
        if (importsPkg && isMemberName) record(node, node.text)
      }
      ts.forEachChild(node, uses)
    }
    uses(sf)
  }

  return hits
}
