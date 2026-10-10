import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { builtinModules } from "node:module";
import ts from "typescript";

const root = process.cwd();
const errors = [];
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, "")));
const contractsOnly = /^@solveflow\/contracts(?:\/|$)/;
// Decision: .agents/notes/implemented/architecture/2026-10-05-source-and-build-boundaries.md
const layers = [
  { root: "apps/mobile", source: "apps/mobile/src/", portable: true,
    allows: name => /^@solveflow\/(?:contracts|client)(?:\/|$)/.test(name) || name === "@solveflow/agent/mobile" },
  { root: "packages/client", source: "packages/client/src/", portable: true, allows: name => contractsOnly.test(name) },
  { root: "packages/contracts", source: "packages/contracts/src/", portable: true, allows: () => false },
  ...["agent", "config", "db"].map(name => ({ root: `packages/${name}`, source: `packages/${name}/src/`, portable: false, allows: name => contractsOnly.test(name) })),
  { root: "apps/api", source: "apps/api/src/", portable: false,
    allows: name => /^@solveflow\/(?:contracts|config|db)(?:\/|$)/.test(name) || ["@solveflow/agent/application", "@solveflow/client/learning"].includes(name) },
];

function inspectImport(name, path, specifier, report) {
  if (/^@(?:earendil-works|mariozechner)\/pi-/.test(specifier) && !name.startsWith("packages/agent/src/pi/")) report("Pi imports are confined to packages/agent/src/pi/");
  // Tests may inspect private sources and use Node fixtures; runtime boundaries still apply to every production file.
  if (/\.(?:test|test-support)\.[cm]?[jt]sx?$/.test(name)) return;
  const layer = layers.find(layer => name.startsWith(layer.source));
  if (!layer) return;
  if (layer.portable && (specifier.startsWith("node:") || builtins.has(specifier))) report(`Node imports are forbidden in ${layer.root}`);
  if (specifier.startsWith("@solveflow/") && !layer.allows(specifier)) report(`Workspace import ${specifier} is forbidden in ${layer.root}`);
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const target = relative(root, resolve(resolve(path, ".."), specifier)).split(sep).join("/");
    const targetLayer = layers.find(layer => target === layer.root || target.startsWith(layer.root + "/"));
    if (targetLayer && targetLayer.root !== layer.root) report("Cross-package file imports must use an approved public entry");
  }
}

async function inspect(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    if (["node_modules", "dist", ".runtime", ".expo", "android", "ios"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await inspect(path); continue; }
    if (!entry.isFile() || !/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(entry.name)) continue;
    const name = relative(root, path).split(sep).join("/");
    const text = await readFile(path, "utf8");
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    const report = message => errors.push(`${name}: ${message}`);
    if (/@ts-(?:ignore|nocheck)/.test(text)) report("TypeScript suppression is forbidden");
    function visit(node) {
      if (node.kind === ts.SyntaxKind.AnyKeyword) report("Explicit any is forbidden");
      let specifier;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier = node.moduleSpecifier;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) specifier = node.moduleReference.expression;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        specifier = node.arguments[0];
        if (!specifier || !ts.isStringLiteralLike(specifier)) report("Computed module loading cannot be audited");
      }
      if (specifier && ts.isStringLiteralLike(specifier)) inspectImport(name, path, specifier.text, report);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}

await inspect(resolve(root, "packages"));
await inspect(resolve(root, "apps"));
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log("Source boundary checks passed (workspace layers, portable imports, Pi imports, explicit any, TS suppressions).");
