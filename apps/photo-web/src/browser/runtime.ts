import { remoteJobs } from './remote-jobs.js';
import { LocalRepository, LocalEngine } from '@solveflow/client/local';
import { openPhotoDocuments } from './documents.js';
export async function openPhotoRuntime(accountId: string) {
  let unlock = () => {};
  if (navigator.locks) await new Promise<void>((resolve, reject) => {
    void navigator.locks.request('solveflow-photo-' + accountId, { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('当前浏览器已有拍题页面，请先关闭另一页。')); return; }
      await new Promise<void>(release => { unlock = release; resolve(); });
    }).catch(reject);
  });
  try {
    const storage = await openPhotoDocuments(accountId); const repository = new LocalRepository(storage.documents);
    try { await repository.recoverInterrupted(); } catch (e) { storage.close(); throw e; }
    const engine = new LocalEngine(repository, () => crypto.randomUUID());
    const remote = await remoteJobs(storage.documents, repository, engine).catch(error => { storage.close(); throw error; });
    return { repository, engine, remote, close: async () => { try { await engine.cancel(); } finally { remote.dispose(); storage.close(); unlock(); } } };
  } catch (e) { unlock(); throw e; }
}
export type PhotoRuntime = Awaited<ReturnType<typeof openPhotoRuntime>>;
