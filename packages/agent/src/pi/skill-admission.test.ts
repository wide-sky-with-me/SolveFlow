import { mkdtemp, mkdir, writeFile, rm, symlink, link, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admitSkills, type ApprovedSkillManifest } from "./skill-admission.js";
import { createApprovedResourceLoader } from "./approved-resource-loader.js";

const roots: string[] = [];
const freshSignal = () => new AbortController().signal;
const manifest: ApprovedSkillManifest[] = [
  { name: "general", directory: "general", files: ["SKILL.md"], requiredTools: [] },
  { name: "math", directory: "math", files: ["SKILL.md", "references/algebra.md"], requiredTools: ["calculate"] },
];
const markdown = (name: string) => `---\nname: ${name}\ndescription: Reviewed ${name} method\n---\nBODY_${name}\nallowed-tools does not grant permission.`;

afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "solveflow-admission-test-"));
  roots.push(root);
  await mkdir(join(root, "general"));
  await mkdir(join(root, "math/references"), { recursive: true });
  await writeFile(join(root, "general/SKILL.md"), markdown("general"));
  await writeFile(join(root, "math/SKILL.md"), markdown("math"));
  await writeFile(join(root, "math/references/algebra.md"), "REFERENCE_ORIGINAL");
  const run = (entries: readonly ApprovedSkillManifest[] = manifest, availableTools = ["read", "calculate"]) => admitSkills({ root, owner: "owner-a", manifest: entries, availableTools, signal: freshSignal() });
  return { root, run };
}

describe("reviewed Skill admission", () => {
  it("uses native metadata for two explicitly admitted skills and virtual immutable references", async () => {
    const f = await fixture();
    const admitted = await f.run();
    expect(admitted.skills.map(skill => skill.name)).toEqual(["general", "math"]);
    expect(admitted.excluded).toEqual([]);
    expect(admitted.skills.every(skill => skill.filePath.startsWith("/solveflow/skills/"))).toBe(true);
    expect(JSON.stringify(admitted.skills)).not.toContain(f.root);
    const loader = createApprovedResourceLoader("test policy", admitted.skills);
    expect(loader.getSkills().skills).toHaveLength(2);
    expect(admitted.snapshot.read("math/references/algebra.md", "owner-a", freshSignal())).toBe("REFERENCE_ORIGINAL");
    expect(admitted.snapshot.read("/solveflow/skills/general/SKILL.md", "owner-a", freshSignal())).toContain("BODY_general");
    expect(admitted.versions.every(version => /^[a-f0-9]{64}$/.test(version.sha256))).toBe(true);
    expect((await f.run()).versions).toEqual(admitted.versions);
  });

  it("excludes missing dependencies without granting privileges from text", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "math/SKILL.md"), markdown("math") + "\nallowed-tools: bash calculate\n");
    const admitted = await f.run(manifest, ["read"]);
    expect(admitted.skills.map(skill => skill.name)).toEqual(["general"]);
    expect(admitted.excluded).toEqual([{ name: "math", missingTools: ["calculate"] }]);
    expect(() => admitted.snapshot.read("math/SKILL.md", "owner-a", freshSignal())).toThrow("RESOURCE_DENIED");
    const none = await f.run(manifest, ["calculate"]);
    expect(none.skills).toEqual([]);
    expect(none.excluded.every(entry => entry.missingTools.includes("read"))).toBe(true);
  });

  it("never discovers unlisted scripts, secrets, contexts or skills in the source tree", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "AGENTS.md"), "FORBIDDEN_CONTEXT");
    await writeFile(join(f.root, "math/.env"), "FORBIDDEN_SECRET");
    await writeFile(join(f.root, "math/script.js"), "throw new Error(\"MUST_NOT_EXECUTE\")");
    await mkdir(join(f.root, "evil"));
    await writeFile(join(f.root, "evil/SKILL.md"), markdown("evil"));
    const admitted = await f.run();
    expect(admitted.skills.map(skill => skill.name)).toEqual(["general", "math"]);
    expect(() => admitted.snapshot.read("math/.env", "owner-a", freshSignal())).toThrow("RESOURCE_DENIED");
    expect(() => admitted.snapshot.read("evil/SKILL.md", "owner-a", freshSignal())).toThrow("RESOURCE_DENIED");
  });

  it("does not change admitted bytes when source files are mutated or replaced by symlinks", async () => {
    const f = await fixture();
    const admitted = await f.run();
    await writeFile(join(f.root, "math/references/algebra.md"), "CHANGED");
    await rm(join(f.root, "general/SKILL.md"));
    await symlink(join(f.root, "math/references/algebra.md"), join(f.root, "general/SKILL.md"));
    expect(admitted.snapshot.read("general/SKILL.md", "owner-a", freshSignal())).toContain("BODY_general");
    expect(admitted.snapshot.read("math/references/algebra.md", "owner-a", freshSignal())).toBe("REFERENCE_ORIGINAL");
    expect(() => admitted.snapshot.read("math/SKILL.md", "owner-b", freshSignal())).toThrow("RESOURCE_DENIED");
  });

  it.each(["../outside", "/etc", ".hidden", "math/../general", "math\\general", "scripts"])("rejects directory escape %s", async directory => {
    const f = await fixture();
    await expect(f.run([{ ...manifest[0]!, directory }])).rejects.toThrow("SKILL_ADMISSION_DENIED");
  });

  it.each([".env", "references/.secret.md", "scripts/run.py", "references/run.js", "references/../../secret.txt", "AGENTS.md", "references/CLAUDE.md", "assets/tool.sh", "references/child/SKILL.md"])("rejects nonapproved file class %s", async file => {
    const f = await fixture();
    await expect(f.run([{ ...manifest[0]!, files: ["SKILL.md", file] }])).rejects.toThrow("SKILL_ADMISSION_DENIED");
  });

  it.each(["file", "directory", "root"])("rejects %s symlinks", async kind => {
    const f = await fixture();
    if (kind === "file") {
      await rm(join(f.root, "general/SKILL.md"));
      await symlink(join(f.root, "math/SKILL.md"), join(f.root, "general/SKILL.md"));
      await expect(f.run()).rejects.toThrow("SKILL_ADMISSION_DENIED");
    } else if (kind === "directory") {
      await rm(join(f.root, "general"), { recursive: true });
      await symlink(join(f.root, "math"), join(f.root, "general"));
      await expect(f.run()).rejects.toThrow("SKILL_ADMISSION_DENIED");
    } else {
      const alias = `${f.root}-alias`;
      roots.push(alias);
      await symlink(f.root, alias);
      await expect(admitSkills({ root: alias, owner: "a", manifest, availableTools: ["read", "calculate"], signal: freshSignal() })).rejects.toThrow("SKILL_ADMISSION_DENIED");
    }
  });

  it("rejects nonregular files and hard links", async () => {
    const f = await fixture();
    await rm(join(f.root, "general/SKILL.md"));
    await mkdir(join(f.root, "general/SKILL.md"));
    await expect(f.run()).rejects.toThrow("SKILL_ADMISSION_DENIED");
    await rm(join(f.root, "general/SKILL.md"), { recursive: true });
    await link(join(f.root, "math/SKILL.md"), join(f.root, "general/SKILL.md"));
    await expect(f.run()).rejects.toThrow("SKILL_ADMISSION_DENIED");
  });

  it("rejects oversized files, total data and manifest depth/count", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "math/references/algebra.md"), "x".repeat(65537));
    await expect(f.run()).rejects.toThrow("SKILL_FILE_LIMIT");
    const refs = Array.from({ length: 5 }, (_, i) => `references/file${i}.txt`);
    for (const file of refs) await writeFile(join(f.root, "math", file), "x".repeat(60_000));
    await expect(f.run([{ name: "math", directory: "math", files: ["SKILL.md", ...refs], requiredTools: [] }])).rejects.toThrow("SKILL_TOTAL_LIMIT");
    await expect(f.run([{ ...manifest[0]!, files: Array.from({ length: 33 }, (_, i) => `references/f${i}.txt`) }])).rejects.toThrow("SKILL_INVALID_OPTIONS");
    await expect(f.run([{ ...manifest[0]!, directory: "a/b/c/d", files: ["SKILL.md", "references/a/b/f.md"] }])).rejects.toThrow("SKILL_DEPTH_LIMIT");
    await expect(f.run([manifest[0]!, manifest[0]!])).rejects.toThrow("SKILL_MANIFEST_LIMIT");
  });

  it("rejects invalid UTF-8 and NUL bytes before native parsing", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "general/SKILL.md"), Buffer.from([0xff]));
    await expect(f.run()).rejects.toThrow("SKILL_INVALID_TEXT");
    await writeFile(join(f.root, "general/SKILL.md"), markdown("general") + "\u0000");
    await expect(f.run()).rejects.toThrow("SKILL_INVALID_TEXT");
  });

  it("rejects metadata mismatch, cleans native parse copies, and observes abort", async () => {
    const f = await fixture();
    const parseRoot = join(f.root, "parse-temporary");
    await mkdir(parseRoot);
    vi.stubEnv("TMPDIR", parseRoot);
    await writeFile(join(f.root, "general/SKILL.md"), markdown("unexpected"));
    await expect(f.run()).rejects.toThrow("SKILL_METADATA_INVALID");
    expect(await readdir(parseRoot)).toEqual([]);
    const controller = new AbortController();
    controller.abort(new Error("CANCELLED"));
    await expect(admitSkills({ root: f.root, owner: "a", manifest, availableTools: ["read"], signal: controller.signal })).rejects.toThrow("CANCELLED");
  });

  it("admits project-authored methodology resources with explicit dependencies", async () => {
    const root = resolve("packages/agent/resources/skills");
    const result = await admitSkills({ root, owner: "a", manifest, availableTools: ["read", "calculate"], signal: freshSignal() });
    expect(result.skills).toHaveLength(2);
    expect(result.snapshot.read("math/references/algebra.md", "a", freshSignal())).toBe(await readFile(join(root, "math/references/algebra.md"), "utf8"));
  });
});
