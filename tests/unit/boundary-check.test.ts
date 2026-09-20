import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const checker = resolve("scripts/check-boundaries.mjs");

it.each([
  ["apps/mobile/src/leak.ts", "import { ModelRuntime } from \"@earendil-works/pi-coding-agent\";", false],
  ["packages/agent/src/pi/allowed.ts", "import { ModelRuntime } from \"@earendil-works/pi-coding-agent\";", true],
  ["apps/api/escape.ts", "const value: any = 1;", false],
  ["apps/api/dynamic.ts", "const name = process.argv[2]; import(name);", false],
])("checks source boundary for %s", async (path, content, allowed) => {
  const root = await mkdtemp(join(tmpdir(), "solveflow-lint-"));
  try {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content.replaceAll("\\\"", "\""));
    const command = exec(process.execPath, [checker], { cwd: root, timeout: 10000 });
    if (allowed) await expect(command).resolves.toMatchObject({ stderr: "" });
    else await expect(command).rejects.toMatchObject({ code: 1 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
