import { Directory, Paths } from 'expo-file-system';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { HISTORY_EXPORT_PART_BYTES, planHistoryExport } from '@solveflow/client';
import { writeNativeHistoryFile } from '../src/local/export-history.native';
import { importHistory } from '../src/local/import-history.native';
import { largePhoto } from './archives';
import { answer, assert, integrity, open, status } from './support';

/** Opt-in manual picker check: select a dedicated empty directory, then this generated file. */
export async function safArchive() {
  assert(Paths.availableDiskSpace > 2 * 1024 ** 3, 'Requires 2 GiB free');
  const from = await open('saf-source'); const to = await open('saf-target');
  const controller = new AbortController();
  try {
    const photo = largePhoto(); const hashes = new Map<string, string>();
    for (let index = 0; index < 63; index++) {
      const record = await from.engine.create(photo, 2, 2);
      await from.engine.start(record.session.id, '', undefined, async () => answer(`**${index}**`));
      await from.engine.waitForIdle();
      hashes.set(record.session.id, await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(await from.repository.exportQuestion(record.session.id))));
      status('saf-archive', 'running', { stage: 'seed', completed: index + 1 });
    }
    const plan = await planHistoryExport(from.repository, controller.signal);
    assert(plan.parts.length === 1 && plan.skipped.length === 0, 'Expected one near-limit SAF volume');
    status('saf-archive', 'running', { stage: 'choose-directory', directory: 'SolveFlowStorageProbe' });
    const directory = await Directory.pickDirectoryAsync();
    assert(directory.name === 'SolveFlowStorageProbe', 'Select the dedicated SolveFlowStorageProbe directory');
    const file = directory.createFile(`solveflow-storage-probe-${Date.now()}.ndjson`, 'application/x-ndjson');
    try {
      await writeNativeHistoryFile(from.repository, file, controller.signal, value => status('saf-archive', 'running', { stage: 'export', ...value }), { ids: plan.parts[0]!.ids, index: 1, total: 1 });
      const bytes = file.size;
      assert(bytes > 120 * 1024 ** 2 && bytes <= HISTORY_EXPORT_PART_BYTES, 'SAF payload did not exercise a near-limit volume');
      status('saf-archive', 'running', { stage: 'choose-backup', name: file.name, bytes });
      const result = await importHistory(to.repository, controller.signal, value => status('saf-archive', 'running', { stage: 'import', ...value }));
      assert(result?.restored === 63 && result.skipped === 0, 'SAF picker did not restore the generated volume');
      for (const [id, hash] of hashes) assert(await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(await to.repository.exportQuestion(id))) === hash, 'SAF round-trip changed a record');
      await integrity(from.db); await integrity(to.db);
      return { questions: 63, bytes, hashesMatched: hashes.size, directoryPicker: true, filePicker: true };
    } finally { file.delete(); }
  } finally { await from.db.closeAsync(); await to.db.closeAsync(); }
}
