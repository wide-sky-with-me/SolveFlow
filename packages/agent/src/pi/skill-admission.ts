import { constants, type BigIntStats } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { loadSkills, type Skill } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { ReadSnapshot, type SnapshotFile } from "../policy/read-snapshot.js";

const VIRTUAL_ROOT = "/solveflow/skills";
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const slug = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const toolName = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/);
const manifestSchema = z.strictObject({
  name: slug,
  directory: z.string().min(1).max(256),
  files: z.array(z.string().min(1).max(256)).min(1).max(32),
  requiredTools: z.array(toolName).max(16),
});
const optionsSchema = z.strictObject({
  root: z.string().min(1).max(4096),
  owner: z.string().min(1).max(128),
  manifest: z.array(manifestSchema).max(16),
  availableTools: z.array(toolName).max(64),
  signal: z.custom<AbortSignal>(value => value instanceof AbortSignal),
});

export interface ApprovedSkillManifest {
  readonly name: string;
  readonly directory: string;
  /** Only SKILL.md and explicit references/assets .md/.txt files are admissible. */
  readonly files: readonly string[];
  readonly requiredTools: readonly string[];
}
export interface SkillAdmissionOptions {
  readonly root: string;
  readonly owner: string;
  readonly manifest: readonly ApprovedSkillManifest[];
  readonly availableTools: readonly string[];
  readonly signal: AbortSignal;
}
export interface SkillAdmissionResult {
  readonly virtualRoot: string;
  readonly skills: Skill[];
  readonly snapshot: ReadSnapshot;
  readonly excluded: ReadonlyArray<{ name: string; missingTools: readonly string[] }>;
  readonly versions: ReadonlyArray<{ name: string; sha256: string }>;
}
export class SkillAdmissionError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SkillAdmissionError"; }
}
const deny = (code = "SKILL_ADMISSION_DENIED"): never => { throw new SkillAdmissionError(code); };

function pathSegments(value: string): string[] {
  const parts = value.split("/");
  if (isAbsolute(value) || parts.length > 4 || parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/.test(part)
    || part === "scripts" || part === "node_modules" || part === "AGENTS.md" || part === "CLAUDE.md")) deny();
  return parts;
}
function validateManifest(manifest: z.infer<typeof manifestSchema>[]): void {
  if (new Set(manifest.map(entry => entry.name)).size !== manifest.length
    || new Set(manifest.map(entry => entry.directory)).size !== manifest.length
    || manifest.reduce((count, entry) => count + entry.files.length, 0) > 32) deny("SKILL_MANIFEST_LIMIT");
  for (const entry of manifest) {
    const directory = pathSegments(entry.directory);
    if (new Set(entry.files).size !== entry.files.length || !entry.files.includes("SKILL.md")) deny();
    for (const file of entry.files) {
      const parts = pathSegments(file);
      if (directory.length + parts.length > 6) deny("SKILL_DEPTH_LIMIT");
      if (file !== "SKILL.md" && (parts.length < 2 || !["references", "assets"].includes(parts[0] ?? "")
        || !/\.(?:md|txt)$/.test(file) || parts.at(-1) === "SKILL.md")) deny();
    }
  }
}
function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

/** Stable administrator-owned directory tree is a REQUIRED deployment precondition.
 * These checks detect ordinary mutation/symlinks, not a malicious host racing rename
 * between operations. In particular O_NOFOLLOW protects only the final component. */
async function checkedPath(root: string, relativePath: string): Promise<{ path: string; stats: BigIntStats }> {
  let path = root;
  let stats = await lstat(root, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(root) !== root) deny();
  const parts = relativePath.split("/");
  for (let i = 0; i < parts.length; i++) {
    path = join(path, parts[i] ?? "");
    stats = await lstat(path, { bigint: true });
    if (stats.isSymbolicLink() || (i < parts.length - 1 && !stats.isDirectory())) deny();
  }
  const canonical = await realpath(path);
  const inside = relative(root, canonical);
  if (canonical !== path || !inside || inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) deny();
  return { path, stats };
}

async function readAdmittedFile(root: string, relativePath: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const before = await checkedPath(root, relativePath);
  if (!before.stats.isFile() || before.stats.nlink !== 1n) deny();
  if (before.stats.size > BigInt(MAX_FILE_BYTES)) deny("SKILL_FILE_LIMIT");
  const fd = await open(before.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await fd.stat({ bigint: true });
    if (!opened.isFile() || !sameNode(before.stats, opened)) deny("SKILL_CHANGED_DURING_ADMISSION");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      signal.throwIfAborted();
      const read = await fd.read(buffer, bytes, buffer.length - bytes, bytes);
      if (read.bytesRead === 0) break;
      bytes += read.bytesRead;
    }
    if (bytes > MAX_FILE_BYTES) deny("SKILL_FILE_LIMIT");
    const after = await fd.stat({ bigint: true });
    const namedAfter = await checkedPath(root, relativePath);
    if (!sameNode(opened, after) || !sameNode(opened, namedAfter.stats) || BigInt(bytes) !== after.size) deny("SKILL_CHANGED_DURING_ADMISSION");
    signal.throwIfAborted();
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes)); }
    catch { return deny("SKILL_INVALID_TEXT"); }
    if (text.includes("\u0000")) deny("SKILL_INVALID_TEXT");
    return text;
  } finally { await fd.close(); }
}

/** Only manifest files are opened; source root is never recursively discovered.
 * Native parsing happens on a private bounded read-only copy, then all native paths
 * are replaced by virtual paths. Both body and references survive only as strings.
 * Temp directory must also be inaccessible to untrusted same-UID host processes. */
export async function admitSkills(input: SkillAdmissionOptions): Promise<SkillAdmissionResult> {
  const parsed = optionsSchema.safeParse(input);
  if (!parsed.success) return deny("SKILL_INVALID_OPTIONS");
  const options = parsed.data;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(5_000)]);
  signal.throwIfAborted();
  if (!isAbsolute(options.root) || resolve(options.root) !== options.root || options.root === parse(options.root).root) deny();
  validateManifest(options.manifest);
  const available = new Set(options.availableTools);
  const excluded: Array<{ name: string; missingTools: string[] }> = [];
  const eligible = options.manifest.filter(entry => {
    const missingTools = [...new Set(["read", ...entry.requiredTools])].filter(tool => !available.has(tool));
    if (missingTools.length) { excluded.push({ name: entry.name, missingTools }); return false; }
    return true;
  });
  const files: SnapshotFile[] = [];
  const versions: Array<{ name: string; sha256: string }> = [];
  const admittedText = new Map<string, string>();
  let total = 0;
  try {
    for (const entry of eligible) {
      const hash = createHash("sha256");
      hash.update(JSON.stringify({ name: entry.name, requiredTools: [...new Set(["read", ...entry.requiredTools])].sort() }));
      for (const file of [...entry.files].sort()) {
        const text = await readAdmittedFile(options.root, `${entry.directory}/${file}`, signal);
        total += Buffer.byteLength(text, "utf8");
        if (total > MAX_TOTAL_BYTES) deny("SKILL_TOTAL_LIMIT");
        const virtualPath = `${VIRTUAL_ROOT}/${entry.name}/${file}`;
        files.push({ path: virtualPath, text });
        admittedText.set(`${entry.name}/${file}`, text);
        hash.update(JSON.stringify([file, text]));
      }
      versions.push({ name: entry.name, sha256: hash.digest("hex") });
    }
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    if (error instanceof SkillAdmissionError) throw error;
    return deny();
  }
  const snapshot = new ReadSnapshot(VIRTUAL_ROOT, options.owner, files);
  if (!eligible.length) return { virtualRoot: VIRTUAL_ROOT, skills: [], snapshot, excluded, versions };
  const temporary = await mkdtemp(join(tmpdir(), "solveflow-skill-admission-"));
  const directories = new Set([temporary]);
  try {
    for (const [path, text] of admittedText) {
      signal.throwIfAborted();
      const target = join(temporary, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      let directory = dirname(target);
      while (directory !== temporary) { directories.add(directory); directory = dirname(directory); }
      await writeFile(target, text, { flag: "wx", mode: 0o400 });
    }
    for (const directory of directories) await chmod(directory, 0o500);
    const loaded = loadSkills({ cwd: temporary, agentDir: temporary, skillPaths: eligible.map(entry => join(temporary, entry.name, "SKILL.md")), includeDefaults: false });
    signal.throwIfAborted();
    if (loaded.diagnostics.length || loaded.skills.length !== eligible.length) deny("SKILL_METADATA_INVALID");
    const skills = eligible.map(entry => {
      const skill = loaded.skills.find(candidate => candidate.filePath === join(temporary, entry.name, "SKILL.md"));
      if (!skill || skill.name !== entry.name || skill.disableModelInvocation) return deny("SKILL_METADATA_INVALID");
      const baseDir = `${VIRTUAL_ROOT}/${entry.name}`;
      const filePath = `${baseDir}/SKILL.md`;
      return { ...skill, baseDir, filePath, sourceInfo: { path: filePath, source: "solveflow-reviewed", scope: "temporary", origin: "top-level", baseDir } } satisfies Skill;
    });
    return { virtualRoot: VIRTUAL_ROOT, skills, snapshot, excluded, versions };
  } finally {
    const restored = await Promise.allSettled([...directories].map(directory => chmod(directory, 0o700)));
    await rm(temporary, { recursive: true, force: true });
    if (restored.some(result => result.status === "rejected")) deny("SKILL_CLEANUP_FAILED");
  }
}
