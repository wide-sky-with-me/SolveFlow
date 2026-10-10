import { Directory, File, Paths } from 'expo-file-system';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { planHistoryExport, HISTORY_EXPORT_PART_BYTES, writeHistoryExport } from '@solveflow/client';
import { z } from 'zod';
import { writeNativeHistoryFile } from '../src/local/export-history.native';
import { readNativeHistoryFile } from '../src/local/import-history.native';
import { answer, assert, hold, instrument, integrity, jpeg, open, recalled, remember, signal, status } from './support';

const root = new Directory(Paths.document, 'probe-archives');
function freshRoot() { if (root.exists) root.delete(); root.create(); }
const digest = (text: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
/** A valid JPEG with bounded COM segments grows the fixture without adding personal images. */
export function largePhoto() {
  const binary = atob(jpeg.slice(jpeg.indexOf(',') + 1));
  const comment = '\xff\xfe\xff\xff' + 'p'.repeat(65_533);
  return 'data:image/jpeg;base64,' + btoa(binary.slice(0, 2) + comment.repeat(24) + binary.slice(2));
}
export async function largeArchive() {
  assert(Paths.availableDiskSpace > 2 * 1024 ** 3, 'Requires 2 GiB free; never fill the device');
  freshRoot();
  const from = await open('archive-source'); const to = await open('archive-target');
  const abort = new AbortController(); const expected = new Map<string, string>(); const photo = largePhoto();
  try {
    for (let index = 0; index < 72; index++) {
      const record = await from.engine.create(photo, 2, 2, 'tmua');
      await from.engine.start(record.session.id, '', undefined, async () => answer(`**${index}**`)); await from.engine.waitForIdle();
      await from.repository.setFavorite(record.session.id, index % 3 === 0);
      expected.set(record.session.id, await digest(JSON.stringify(await from.repository.exportQuestion(record.session.id))));
      status('large-archive', 'running', { stage: 'seed', completed: index + 1, total: 72 });
    }
    const plan = await planHistoryExport(from.repository, signal);
    assert(plan.parts.length >= 2 && plan.skipped.length === 0, 'Fixture did not cross the production 128 MiB limit');
    const files: File[] = []; let totalBytes = 0;
    for (const [index, part] of plan.parts.entries()) {
      const file = new File(root, `part-${index + 1}.ndjson`); file.create();
      await writeNativeHistoryFile(from.repository, file, abort.signal, progress => status('large-archive', 'running', { stage: 'export', part: index + 1, ...progress }), { ids: part.ids, index: index + 1, total: plan.parts.length });
      assert(file.size > 0 && file.size <= HISTORY_EXPORT_PART_BYTES, 'Native archive size exceeded limit');
      totalBytes += file.size; files.push(file);
    }
    assert(totalBytes > HISTORY_EXPORT_PART_BYTES, 'Insufficient archive payload');
    let restored = 0; let skipped = 0;
    for (const file of [...files].reverse()) {
      const progress = (value: { phase: string; completed: number }) => status('large-archive', 'running', { stage: 'restore', file: file.name, ...value });
      restored += (await readNativeHistoryFile(to.repository, file, abort.signal, progress)).restored;
      skipped += (await readNativeHistoryFile(to.repository, file, abort.signal, progress)).skipped;
    }
    assert(restored === 72 && skipped === 72 && (await to.repository.recordIds()).length === 72, 'Round trip duplicated or lost questions');
    for (const [id, hash] of expected) assert(await digest(JSON.stringify(await to.repository.exportQuestion(id))) === hash, 'Question/image/favorite/answer changed');
    await integrity(from.db); await integrity(to.db);
    return { questions: 72, parts: files.map(file => ({ name: file.name, bytes: file.size })), totalBytes, restored, duplicateSkipped: skipped, hashesMatched: expected.size };
  } finally { await from.db.closeAsync(); await to.db.closeAsync(); }
}
async function smallBackup() {
  if (!root.exists) root.create();
  const from = await open('kill-import-source');
  const file = new File(root, 'kill-import.ndjson'); if (file.exists) file.delete(); file.create();
  const ids: string[] = [];
  try {
    for (let i = 0; i < 4; i++) ids.push((await from.engine.create(jpeg, 2, 2)).session.id);
    await writeHistoryExport(from.repository, async line => { file.write(line, { append: true }); }, signal);
    remember('kill-import', { ids }); return file;
  } finally { await from.db.closeAsync(); }
}
export async function killImport() {
  const file = await smallBackup(); const to = await open('kill-import-target'); const control = instrument(to.db);
  let commits = 0;
  control.afterCommit = async () => { if (++commits === 2) await hold('kill-import', { committedQuestions: commits }); };
  await readNativeHistoryFile(to.repository, file, new AbortController().signal, () => {});
  throw new Error('Import escaped process-stop checkpoint');
}
export async function checkImport() {
  const to = await open('kill-import-target', false);
  try {
    const { ids } = z.object({ ids: z.array(z.uuid()).length(4) }).parse(recalled('kill-import'));
    assert((await to.repository.recordIds()).length === 2, 'Expected exactly two committed records after kill');
    const result = await readNativeHistoryFile(to.repository, new File(root, 'kill-import.ndjson'), new AbortController().signal, () => {});
    assert(result.restored === 2 && result.skipped === 2 && (await to.repository.recordIds()).length === 4, 'Reimport did not safely complete');
    for (const id of ids) assert((await to.repository.read(id)).image === jpeg, 'Restored image mismatch');
    await integrity(to.db); return { before: 2, after: 4, ...result, integrity: 'ok' };
  } finally { await to.db.closeAsync(); }
}

export async function archiveFailures() {
  const file = await smallBackup(); const to = await open('archive-failure-target'); const from = await open('kill-import-source', false);
  try {
    const existing = await to.engine.create(jpeg, 2, 2);
    const before = await digest(JSON.stringify(await to.repository.exportQuestion(existing.session.id)));
    const truncated = new File(root, 'truncated.ndjson'); truncated.write(file.textSync().replace(/[^\n]+\n$/, ''));
    let rejected = false;
    try { await readNativeHistoryFile(to.repository, truncated, new AbortController().signal, () => {}); } catch { rejected = true; }
    assert(rejected && (await to.repository.recordIds()).length === 1, 'Truncated archive wrote records');
    const cancelImport = new AbortController(); let progressReached = false; let cancelRejected = false;
    try {
      await readNativeHistoryFile(to.repository, file, cancelImport.signal, value => {
        if (value.phase === 'restoring' && value.completed === 2) { progressReached = true; cancelImport.abort(); }
      });
    } catch { cancelRejected = true; }
    assert(cancelRejected && cancelImport.signal.aborted && progressReached, 'Restore did not reject at the cancellation checkpoint');
    assert((await to.repository.recordIds()).length === 1, 'Cancelled restore left new records');
    assert(await digest(JSON.stringify(await to.repository.exportQuestion(existing.session.id))) === before, 'Existing data changed');
    const cancelledFile = new File(root, 'cancelled.ndjson'); cancelledFile.create();
    const cancelExport = new AbortController();
    const result = await writeNativeHistoryFile(from.repository, cancelledFile, cancelExport.signal, value => { if (value.completed === 1) cancelExport.abort(); });
    assert(result === null && !cancelledFile.exists, 'Cancelled export left a partial file or returned success');
    assert(!new Directory(Paths.cache, 'history-restore').exists, 'Restore left private cache');
    await integrity(to.db); return { truncatedRejectedBeforeWrites: true, cancelledRestoreRolledBack: true, existingHashMatched: true, cancelledExportRemoved: true, cacheCleaned: true };
  } finally { await from.db.closeAsync(); await to.db.closeAsync(); }
}
