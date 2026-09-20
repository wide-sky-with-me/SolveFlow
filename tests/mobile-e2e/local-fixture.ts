import { AnswerCandidateSchema } from '../../packages/contracts/src/agent.js';
import { expect, type Page } from '@playwright/test';
import type { SessionView } from '../../packages/contracts/src/http.js';
export async function seedLocalSession(page: Page, session: SessionView, image: Buffer) {
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
  await page.evaluate(async record => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; }); await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(JSON.stringify(record), `record.${record.session.id}`); tx.oncomplete = () => resolve(); tx.onerror = reject; }); db.close(); }, { schemaVersion: 1, session, image: `data:image/jpeg;base64,${image.toString('base64')}` });
  await page.goto(`/?session=${session.id}`); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
}
export async function configureLocalModel(page: Page) {
  if (!await page.getByLabel('解题服务地址', { exact: true }).isVisible()) { await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click(); }
  await page.getByLabel('解题服务地址', { exact: true }).fill('https://fixture-model.invalid/v1'); await page.getByLabel('解题供应商标识', { exact: true }).fill('fixture-provider'); await page.getByLabel('解题模型引用名', { exact: true }).fill('fixture-user-model'); await page.getByLabel('解题API Key', { exact: true }).fill('synthetic-fixture-secret'); await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible(); await page.getByRole('tab', { name: '题目', exact: true }).click();
}
/** Fake provider obeys the requested output mode; stored legacy fixtures stay intact. */
export function fixtureForMode(value: unknown, request: unknown) {
  const input = lastModelInput(request); const answer = AnswerCandidateSchema.safeParse(value);
  if (!answer.success || typeof input !== 'object' || input === null || !('answerMode' in input) || input.answerMode !== 'brief') return value;
  const { knowledgeDetails: _details, ...candidate } = answer.data;
  return { ...candidate, steps: [], knowledgePoints: [], ...(candidate.questions ? { questions: candidate.questions.map(({ knowledgeDetails: _details, ...question }) => ({ ...question, stepIds: [] })) } : {}) };
}
export function modelSse(value: unknown, request?: unknown) { if (request) value = fixtureForMode(value, request); return `data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`; }
export const modelPass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic', 'diagram'], issues: [] };
export function lastModelInput(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('messages' in body) || !Array.isArray(body.messages)) throw new Error('INVALID_MODEL_REQUEST');
  for (const message of [...body.messages].reverse()) {
    if (typeof message !== 'object' || message === null || !('role' in message) || message.role !== 'user' || !('content' in message)) continue;
    const content: unknown = message.content;
    if (typeof content === 'string') return JSON.parse(content);
    if (Array.isArray(content)) { for (const part of content) { if (typeof part === 'object' && part !== null && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') return JSON.parse(part.text); } }
  }
  throw new Error('MISSING_USER_PROMPT');
}
export async function chooseSyntheticPhoto(page: Page) {
  const buffer = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = '#111'; ctx.font = '32px sans-serif'; ctx.fillText('x + 1 = 3', 50, 150); return canvas.toDataURL('image/jpeg').split(',')[1]!; }), 'base64');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '从相册选择', exact: true }).click(); await (await chooser).setFiles({ name: 'fixture.jpg', mimeType: 'image/jpeg', buffer }); await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
}
