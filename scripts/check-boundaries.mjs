import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import ts from "typescript";

const root = process.cwd();
const errors = [];

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
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        specifier = node.arguments[0];
        if (!specifier || !ts.isStringLiteralLike(specifier)) report("Computed module loading cannot be audited");
      }
      if (specifier && ts.isStringLiteralLike(specifier) && /^@(?:earendil-works|mariozechner)\/pi-/.test(specifier.text) && !name.startsWith("packages/agent/src/pi/")) report("Pi imports are confined to packages/agent/src/pi/");
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}

await inspect(resolve(root, "packages"));
await inspect(resolve(root, "apps"));
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log("Source boundary checks passed (Pi imports, explicit any, TS suppressions).");
