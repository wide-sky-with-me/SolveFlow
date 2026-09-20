import { fixtureForMode } from './local-fixture.js';
import { test, expect, type Page } from '@playwright/test';
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: '解方程：$x+1=3$。', subject: 'math', uncertainties: [] }, answer: '$x=2$', steps: [{ id: 's1', title: '等式两边同时减一', explanation: '两边同时减1，得 $x=2$。' }], knowledgePoints: ['等式性质'], knowledgeDetails: [{ name: '等式性质', explanation: '等式两边同时减去同一个数，等式仍成立。', application: '两边同时减1。' }], citationIds: [], clarificationQuestions: [] };
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'arithmetic', 'logic'], issues: [] };
function answer(value: unknown) { return `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-user-model', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`; }
async function settings(page: Page) {
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('解题服务地址', { exact: true }).fill('https://fixture-model.invalid/v1'); await page.getByLabel('解题供应商标识', { exact: true }).fill('fixture-provider'); await page.getByLabel('解题模型引用名', { exact: true }).fill('fixture-user-model'); await page.getByLabel('解题API Key', { exact: true }).fill('synthetic-fixture-secret'); await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible(); await page.getByRole('tab', { name: '题目', exact: true }).click();
}
async function photo(page: Page) {
  const buffer = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = '#111'; ctx.font = '32px sans-serif'; ctx.fillText('x + 1 = 3', 50, 150); return canvas.toDataURL('image/jpeg').split(',')[1]!; }), 'base64');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '从相册选择', exact: true }).click(); await (await chooser).setFiles({ name: 'fixture.jpg', mimeType: 'image/jpeg', buffer }); await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
}
test('local settings, direct Pi solve, per-question follow-up and offline reopen without persisted keys', async ({ page }) => {
  const bodies: unknown[] = []; let backendRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/v1/')) backendRequests++; });
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { const request = route.request(); bodies.push(request.postDataJSON()); expect(request.headers()['authorization']).toBe('Bearer synthetic-fixture-secret'); await route.fulfill({ status: 200, contentType: 'text/event-stream', body: answer(fixtureForMode(candidate, request.postDataJSON())), headers: { 'access-control-allow-origin': '*' } }); });
  await page.goto('/'); await settings(page); await photo(page); await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('未校验', { exact: true })).toBeVisible(); await expect(page.locator('.katex').first()).toBeVisible(); expect(bodies).toHaveLength(1);
  await page.locator('.knowledge-toggle>summary').click(); await expect(page.getByRole('region', { name: '本题知识点', exact: true })).toBeVisible();
  await page.getByRole('region', { name: '本题知识点', exact: true }).locator('summary').click(); await page.getByRole('button', { name: '追问这个知识点', exact: true }).click();
  await page.getByLabel('继续问这道题', { exact: true }).fill('解释这个知识点'); await page.getByRole('button', { name: '发送同题追问', exact: true }).click(); await expect(page.getByRole('button', { name: '历史解答', exact: true })).toBeVisible(); await expect(page.getByText('未校验', { exact: true })).toBeVisible(); expect(bodies).toHaveLength(3);
  expect(JSON.stringify(bodies[2])).toContain('等式性质'); expect(backendRequests).toBe(0);
  const local = await page.evaluate(async () => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; }); const result = await new Promise<unknown>((resolve, reject) => { const r = db.transaction('documents').objectStore('documents').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = reject; }); db.close(); return JSON.stringify(result); });
  expect(local).not.toContain('synthetic-fixture-secret'); expect(local).toContain('data:image/jpeg;base64,');
  await page.reload(); await expect(page.getByText('未校验', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '发送同题追问', exact: true })).toBeDisabled(); expect(bodies).toHaveLength(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('button', { name: '题目操作', exact: true }).click(); await page.getByRole('button', { name: '移除', exact: true }).click(); await page.getByRole('button', { name: '确认删除', exact: true }).click(); await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await expect(page.getByText('还没有解题记录', { exact: true })).toBeVisible();
});
test('unconfigured application saves and reads photos entirely locally', async ({ page }) => {
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible(); await photo(page); await page.getByRole('button', { name: '保存题目', exact: true }).click(); await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await expect(page.getByText('已保存的题目', { exact: false })).toBeVisible(); expect(calls).toBe(0);
});
test('settings reject insecure endpoints and another tab cannot acquire the local database run lock', async ({ page, context }) => {
  await page.goto('/'); await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByLabel('解题服务地址', { exact: true }).fill('http://bad.invalid/v1'); await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByText(/保存失败/)).toBeVisible();
  const other = await context.newPage(); await other.goto('/'); await expect(other.getByText(/已在其他标签页打开/)).toBeVisible(); await other.close();
});
for (const nativeSignal of [false, true]) test(`browser Pi executes read and calculate under the production CSP (native signal: ${nativeSignal})`, async ({ page }) => {
  if (nativeSignal) await page.addInitScript(() => {
    Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', { configurable: true, value: undefined });
    Object.defineProperty(AbortSignal.prototype, 'reason', { configurable: true, value: undefined });
  });
  let calls = 0;
  function tool(name: string, args: object) { return `data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`; }
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++; const body: unknown = route.request().postDataJSON();
    if (calls === 2) expect(body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'tool', content: expect.stringContaining('name: math') })]) });
    if (calls === 3) expect(body).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'tool', content: expect.stringContaining('"value":"2"') })]) });
    await route.fulfill({ contentType: 'text/event-stream', body: calls === 1 ? tool('read', { path: '/skills/math/SKILL.md' }) : calls === 2 ? tool('calculate', { schemaVersion: 1, expression: '3-1', angleUnit: 'rad' }) : answer(fixtureForMode(candidate, route.request().postDataJSON())) });
  });
  await page.goto('/'); await settings(page); await photo(page); await page.getByRole('button', { name: '开始解题', exact: true }).click(); await expect(page.getByText('未校验', { exact: true })).toBeVisible(); expect(calls).toBe(3);
});
