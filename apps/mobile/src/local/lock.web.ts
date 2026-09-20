export async function lockLocalApp(): Promise<void> {
  if (!navigator.locks) throw new Error('当前浏览器不支持本地任务锁，请使用新版浏览器及 HTTPS 或 localhost。');
  await new Promise<void>((resolve, reject) => {
    void navigator.locks.request('solveflow-local-app', { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('SolveFlow 已在其他标签页打开。请关闭其他页面，再刷新本页。')); return; }
      resolve(); await new Promise<void>(() => { /* Released automatically when the document closes. */ });
    }).catch(() => reject(new Error('无法取得本地任务锁。')));
  });
}
