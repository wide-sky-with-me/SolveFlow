import { constants, closeSync, fsyncSync, openSync, lstatSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

/** Explicit first-use operation only. The permanent marker survives a missing
 * journal and refuses reinitialization; never automatically reset after a failure. */
export function initializeLedger(path: string): void {
  if (!isAbsolute(path)) throw new Error("INVALID_LEDGER_CONFIG");
  for (const name of [path, path + ".lock"]) {
    try { lstatSync(name); throw new Error("LEDGER_ALREADY_EXISTS"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
  const marker = openSync(path + ".initialized", constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    fsyncSync(marker);
    const directory = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(directory);
      const journal = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { fsyncSync(journal); } finally { closeSync(journal); }
      fsyncSync(directory);
    } finally { closeSync(directory); }
  } finally { closeSync(marker); }
}
