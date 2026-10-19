import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { routeModules, tables, approvedDatabaseAccess, pendingDatabaseAccess,
  filesystemWriters, backgroundEntries, disabledModules } from './helpers/tenant-boundary-baseline.mjs'

const root = fileURLToPath(new URL('../src/', import.meta.url))
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
})
const files = new Map(walk(root).map(full => {
  const name = path.relative(root, full).replaceAll('\\', '/')
  return [name, ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true)]
}))
const sorted = values => [...values].sort()
const imports = source => {
  const result = []
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      result.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      result.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}
function localDependency(file, specifier) {
  if (!specifier.startsWith('.')) return null
  const name = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.js$/, '.ts')
  return files.has(name) ? name : null
}
function visitCalls(source, callback) {
  const visit = node => {
    if (ts.isCallExpression(node)) callback(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const reachable = new Set()
function follow(file) {
  if (reachable.has(file)) return
  reachable.add(file)
  for (const specifier of imports(files.get(file))) {
    const dependency = localDependency(file, specifier)
    if (dependency) follow(dependency)
  }
}
follow('index.ts')

test('all route modules and PostgreSQL tables have an explicit classification', () => {
  assert.deepEqual(sorted([...files.keys()].filter(name => name.startsWith('routes/')).map(name => name.slice(7))), sorted(Object.keys(routeModules)))
  const definitions = []
  visitCalls(files.get('db/schema.ts'), node => {
    if (node.expression.getText() === 'pgTable' && ts.isStringLiteral(node.arguments[0])) definitions.push(node.arguments[0].text)
  })
  assert.deepEqual(sorted(definitions), sorted(Object.keys(tables)))
  const schema = files.get('db/schema.ts').text
  for (const table of definitions) {
    if (tables[table] === 'system-shared') continue
    const section = schema.split(`pgTable('${table}',`)[1].split('\nexport const ')[0]
    assert.match(section, /userId: integer\('user_id'\)/, `${table} is missing ownership`)
    if (tables[table] === 'tenant-private') assert.match(section, /userId: integer\('user_id'\)\.notNull\(\)/)
  }
})

test('disabled legacy, server-management and global credential modules are unreachable from Web startup', () => {
  for (const file of disabledModules) {
    assert.ok(files.has(file), `${file} must be reviewed before removal`)
    assert.ok(!reachable.has(file), `${file} must not be reachable from src/index.ts`)
  }
  for (const [file, classification] of Object.entries(routeModules)) {
    if (classification === 'tenant-private') assert.ok(reachable.has(`routes/${file}`), `${file} is not reachable`)
  }
})

test('all direct database imports are tracked and new directories cannot bypass the boundary', () => {
  const direct = [...files.entries()].filter(([, source]) => imports(source).some(specifier => /(?:^|\/)db\/index(?:\.[jt]s)?$/.test(specifier))).map(([name]) => name)
  assert.deepEqual(sorted(direct), sorted([...Object.keys(approvedDatabaseAccess), ...Object.keys(pendingDatabaseAccess)]))
  for (const [name, classification] of Object.entries(approvedDatabaseAccess)) {
    if (classification !== 'tenant-private') continue
    const source = files.get(name)
    for (const statement of source.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
      assert.equal(statement.parameters[0]?.type?.getText(source), 'TenantContext', `${name}:${statement.name?.text} must require TenantContext first`)
    }
  }
})

test('ordinary routes and services have no remaining direct database access', () => {
  assert.deepEqual(Object.keys(pendingDatabaseAccess), [], `Migration still required: ${Object.keys(pendingDatabaseAccess).join(', ')}`)
})

test('filesystem writers and every background entry remain explicitly classified', () => {
  const writers = []
  const mutations = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'mkdir', 'mkdirSync',
    'rename', 'renameSync', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'copyFile', 'copyFileSync', 'truncate', 'truncateSync', 'open', 'openSync'])
  for (const [name, source] of files) {
    const fsNames = new Set()
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !/^(?:node:)?fs(?:\/promises)?$/.test(node.moduleSpecifier.text)) continue
      if (node.importClause?.name) fsNames.add(node.importClause.name.text)
      if (node.importClause?.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) fsNames.add(node.importClause.namedBindings.name.text)
      if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const entry of node.importClause.namedBindings.elements) if (mutations.has(entry.propertyName?.text ?? entry.name.text)) fsNames.add(entry.name.text)
      }
    }
    let writes = false
    visitCalls(source, node => {
      const target = node.expression.getText(source).split('.')
      if (fsNames.has(target[0]) && (target.length === 1 || mutations.has(target.at(-1)))) writes = true
    })
    if (writes) writers.push(name)
  }
  assert.deepEqual(sorted(writers), sorted(Object.keys(filesystemWriters)))
  for (const [file, classification] of Object.entries(backgroundEntries)) {
    assert.ok(files.has(file))
    assert.equal(reachable.has(file), classification !== 'web-disabled', file)
  }
  assert.ok(existsSync(new URL('../tests/helpers/browser-preview.ts', import.meta.url)))
  assert.doesNotMatch(files.get('index.ts').text, /browser-preview|tests\/helpers/)
})
