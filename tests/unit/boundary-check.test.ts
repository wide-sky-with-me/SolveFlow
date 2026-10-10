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
  ["apps/mobile/src/config.ts", 'import { loadConfig } from "@solveflow/config";', false],
  ["apps/mobile/src/database.ts", 'export { Repository } from "@solveflow/db";', false],
  ["apps/mobile/src/server.ts", 'import "@solveflow/agent/application";', false],
  ["apps/mobile/src/node.ts", 'import { readFile } from "node:fs/promises";', false],
  ["apps/mobile/src/node-bare.ts", 'const fs = require("fs/promises");', false],
  ["apps/mobile/src/dynamic-db.ts", 'import("@solveflow/db");', false],
  ["apps/mobile/src/private.ts", 'import "../../../packages/client/src/local-engine.js";', false],
  ["apps/mobile/src/private-pi.ts", 'import "../../../packages/agent/src/pi/mobile.js";', false],
  ["apps/mobile/src/type.ts", 'type Database = import("@solveflow/db").Database;', false],
  ["apps/mobile/src/import-equals.ts", 'import fs = require("node:fs");', false],
  ["packages/client/src/config.ts", 'import type { Config } from "@solveflow/config";', false],
  ["packages/client/src/node.ts", 'import "node:worker_threads";', false],
  ["packages/client/src/private.ts", 'export * from "../../agent/src/pi/mobile.js";', false],
  ["packages/contracts/src/ui.ts", 'import "@solveflow/client";', false],
  ["packages/contracts/src/node.ts", 'import type { Buffer } from "buffer";', false],
  ["packages/agent/src/config.ts", 'import "@solveflow/config";', false],
  ["packages/db/src/ui.ts", 'import "@solveflow/client/local";', false],
  ["apps/mobile/src/runtime.ts", 'import "@solveflow/agent/mobile"; import "@solveflow/client/local";', true],
  ["packages/client/src/local.ts", 'export * from "@solveflow/contracts/local";', true],
  ["apps/mobile/app.config.ts", 'import "node:path";', true],
  ["apps/mobile/src/storage.test.ts", 'import "node:fs/promises";', true],
  ["apps/api/src/worker.ts", 'import "@solveflow/config"; import "node:worker_threads";', true],
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
