import { isAbsolute, relative, resolve, sep } from "node:path";

export interface SnapshotFile { readonly path: string; readonly text: string }

/** Trusted, bounded admission input; never populate this from model-supplied paths.
 * Runtime reads use immutable strings, not the host filesystem (no read-time TOCTOU).
 * Deployment admission of files is a separate, still-required security boundary. */
export class ReadSnapshot {
  private readonly files = new Map<string, string>();
  private revoked = false;
  readonly root: string;

  constructor(root: string, private readonly owner: string, files: readonly SnapshotFile[]) {
    if (!isAbsolute(root) || !owner || files.length > 32) throw new Error("INVALID_SNAPSHOT");
    this.root = resolve(root);
    let total = 0;
    for (const file of files) {
      const path = this.authorizePath(file.path);
      const bytes = Buffer.byteLength(file.text, "utf8");
      total += bytes;
      if (bytes > 64 * 1024 || total > 256 * 1024 || this.files.has(path)) {
        throw new Error("INVALID_SNAPSHOT");
      }
      this.files.set(path, file.text);
    }
  }

  private authorizePath(path: string): string {
    if (!path || path.length > 4096 || /[\\\x00-\x1f]/u.test(path)
      || path.startsWith("~") || path.startsWith("@")
      || path.split("/").some(part => part === ".." || part.startsWith("."))) {
      throw new Error("RESOURCE_DENIED");
    }
    const absolute = resolve(this.root, path);
    const inside = relative(this.root, absolute);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw new Error("RESOURCE_DENIED");
    }
    return absolute;
  }

  read(path: string, owner: string, signal: AbortSignal): string {
    signal.throwIfAborted();
    if (this.revoked || owner !== this.owner) throw new Error("RESOURCE_DENIED");
    const text = this.files.get(this.authorizePath(path));
    if (text === undefined) throw new Error("RESOURCE_DENIED");
    return text;
  }

  revoke(): void { this.revoked = true; }
}
