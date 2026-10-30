import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { LocalBatchQueue, LocalEngine, LocalRepository } from '../../packages/client/src/local.js';
import type { SolveOutcome } from '../../packages/contracts/src/agent.js';

for (const recovery of ['retry', 'supplement'] as const) test(`a failed two-question attempt recovered by ${recovery} remains in history without an empty exported question`, async ({ page, context }, info) => {
  await context.route('**/__solveflow/web-env/model/**', route => route.abort());
  await context.route('https://**/*', route => route.abort());
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,600,300); ctx.fillStyle = '#222'; ctx.fillText('Synthetic grouped source',20,50);
    return canvas.toDataURL('image/jpeg');
  });
  const documents = new Map<string,string>();
  const repository = new LocalRepository({ get: async key => documents.get(key) ?? null, keys: async () => [...documents.keys()], put: async (key,value) => { documents.set(key,value); }, remove: async key => { documents.delete(key); }, batch: async changes => { for (const { key, value } of changes) if (value === null) documents.delete(key); else documents.set(key, value); } });
  const engine = new LocalEngine(repository, randomUUID), queue = new LocalBatchQueue(engine);
  const batch = { id: randomUUID(), title: 'Grouped retry export', createdAt: new Date().toISOString(), exam: 'general' as const, position: 1 };
  const record = await engine.create(image,600,300,'general',batch);
  await engine.start(record.session.id,'请解答第1、2题。',undefined,async () => { throw new Error('SYNTHETIC_FAILURE'); }); await engine.waitForIdle();
  const outcome: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic questions 1 and 2', subject: 'math', uncertainties: [] }, answer: '2 and 4', questions: [1,2].map(number => ({ number, answer: String(number * 2), stepIds: [], figureIds: [] })), steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
  if (recovery === 'supplement') {
    await queue.addMaterials({ batchId: batch.id, images: [{ image, width: 600, height: 300, sessionIds: [record.session.id] }] }, async input => {
      expect(input.message).toBe('请解答第1、2题。'); expect(input.materials).toHaveLength(1); return outcome;
    });
  } else await queue.enqueue(record.session.id, async () => outcome, true);
  await queue.waitForIdle();
  const saved = await repository.read(record.session.id);
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.evaluate(record => new Promise<void>((resolve,reject) => {
    const open = indexedDB.open('solveflow-local'); open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result; const tx = db.transaction('documents','readwrite'); tx.objectStore('documents').put(JSON.stringify(record),`record.${record.session.id}`); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  }),saved);
  await page.goto(`/?session=${saved.session.id}`); await expect(page.getByTestId('current-batch')).toBeVisible();
  await page.getByRole('button',{ name:'批次操作',exact:true }).click(); await page.getByRole('button',{ name:'导出本批 PDF',exact:true }).click(); await page.getByRole('button',{ name:'快速原文（最快）',exact:true }).click();
  await expect(page.getByLabel('第1份答对题数',{ exact:true })).toHaveText('对 2 题');
  await expect(page.getByTestId('export-preflight')).not.toContainText('缺少已解析题干');
  const waiting = page.waitForEvent('download'); await page.getByRole('button',{ name:'下载 PDF',exact:true }).click();
  const file = info.outputPath('grouped-retry.pdf'); await (await waiting).saveAs(file); expect((await readFile(file)).subarray(0,5).toString()).toBe('%PDF-');
  const source = await repository.read(record.session.id); expect(source.session.runs.map(run => run.status)).toEqual(['failed','completed']);
});
