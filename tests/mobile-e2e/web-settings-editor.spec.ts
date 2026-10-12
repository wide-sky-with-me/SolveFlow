import { expect, test } from '@playwright/test';
import { WebEnvironmentSchema, WebModelUpdateSchema } from '../../packages/contracts/src/local.js';
import { chooseSyntheticPhoto, modelSse } from './local-fixture.js';
const profile = { provider: 'fixture', baseURL: 'https://fixture-settings.invalid/v1', model: 'primary', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
test.use({ launchOptions: { executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
test('Web settings edit, test and save locally, keep secrets off browser storage and use the new model immediately', async ({ page }, info) => {
  let environment = WebEnvironmentSchema.parse({ schemaVersion: 1, canEditModels: true, settings: { schemaVersion: 1, solver: profile, verifier: null, backup: null }, accessTokens: { solver: 'synthetic-initial-token', verifier: null, backup: null } });
  let saves = 0; let checks = 0; let solves = 0; let external = 0;
  await page.route('https://*.invalid/**', route => { external++; return route.abort(); });
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: environment }));
  await page.route('**/__solveflow/web-env/settings', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${environment.accessTokens.solver}`);
    const update = WebModelUpdateSchema.parse(route.request().postDataJSON());
    if (!update.keys.solver && update.models.solver.baseURL !== environment.settings.solver.baseURL) { await route.fulfill({ status: 400, body: '{}' }); return; }
    saves++;
    environment = WebEnvironmentSchema.parse({ schemaVersion: 1, canEditModels: true, settings: { schemaVersion: 1, ...update.models }, accessTokens: { solver: `synthetic-saved-token-${saves}`, verifier: update.models.verifier ? 'synthetic-verifier-token' : null, backup: update.models.backup ? 'synthetic-backup-token' : null } });
    await route.fulfill({ json: environment });
  });
  await page.route('**/__solveflow/web-env/test/*', async route => {
    const body: unknown = route.request().postDataJSON(); expect(body).toMatchObject({ profile: { model: 'edited-primary' }, key: null });
    expect(route.request().headers().authorization).toBe(`Bearer ${environment.accessTokens.solver}`); checks++;
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse('OK') });
  });
  await page.route('**/__solveflow/web-env/model/solver', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${environment.accessTokens.solver}`);
    expect(route.request().postDataJSON()).toMatchObject({ model: 'edited-primary' }); solves++;
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, route.request().postDataJSON()) });
  });
  await page.goto('/'); await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('解题模型引用名', { exact: true })).toBeEditable(); await expect(page.getByLabel('解题API Key', { exact: true })).toHaveValue('');
  await expect(page.getByText(/初始配置来自/)).toHaveCount(0); await page.getByRole('button', { name: '配置说明', exact: true }).click(); await expect(page.getByText(/初始配置来自/)).toBeVisible(); await page.getByRole('button', { name: '配置说明', exact: true }).click();
  await page.getByLabel('解题模型引用名', { exact: true }).fill('unsaved'); await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click(); await expect(page.getByLabel('解题模型引用名', { exact: true })).toHaveValue('primary'); expect(saves).toBe(0);
  await page.getByLabel('解题模型引用名', { exact: true }).fill('edited-primary'); await page.getByRole('button', { name: '测试解题模型连接', exact: true }).click(); await expect(page.getByText(/文本连接测试通过/)).toBeInViewport({ ratio: 1 }); expect(checks).toBe(1); expect(saves).toBe(0);
  await page.getByLabel('解题服务地址', { exact: true }).fill('https://new-settings.invalid/v1'); await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByText(/模型配置无效；新增或更换服务/)).toBeInViewport({ ratio: 1 }); expect(saves).toBe(0);
  await page.getByLabel('解题API Key', { exact: true }).fill('synthetic-editor-provider-key');
  await page.getByRole('button', { name: '解题高级参数', exact: true }).click(); await page.getByLabel('解题最大输出 tokens', { exact: true }).fill('4096');
  await page.getByLabel('答题并发', { exact: true }).fill('12'); await page.getByLabel('校验并发', { exact: true }).fill('10');
  await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(saves).toBe(1);
  await page.getByRole('tab', { name: '题目', exact: true }).click(); await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '开始解题', exact: true }).click(); await expect(page.locator('.final-answer').filter({ visible: true })).toContainText('x=2'); expect(solves).toBe(1); expect(external).toBe(0);
  await page.reload(); await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('解题模型引用名', { exact: true })).toHaveValue('edited-primary'); await expect(page.getByLabel('解题API Key', { exact: true })).toHaveValue(''); await expect(page.getByLabel('答题并发', { exact: true })).toHaveValue('12'); expect(solves).toBe(1);
  const stored = await page.evaluate(() => new Promise<string>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents'); const get = tx.objectStore('documents').getAll(); tx.oncomplete = () => { db.close(); resolve(JSON.stringify(get.result)); }; }; }));
  expect(stored).not.toContain('synthetic-editor-provider-key'); expect(stored).not.toContain('synthetic-saved-token');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [390, 1280, 1920]) {
      await page.setViewportSize({ width, height: 1000 }); await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width >= 1100) {
        const boxes = await Promise.all(['解题模型', '校验模型', '备用解题模型'].map(name => page.getByRole('region', { name, exact: true }).boundingBox()));
        expect(boxes.every(box => !!box)).toBe(true); expect(boxes[0]!.y).toBeCloseTo(boxes[2]!.y, 0); expect(boxes[1]!.x + boxes[1]!.width).toBeLessThan(boxes[2]!.x);
        expect(boxes[1]!.height).toBeLessThan(boxes[0]!.height / 2); expect(boxes[2]!.height).toBeLessThan(boxes[0]!.height / 2);
      }
      await expect.poll(async () => Math.round((await page.getByTestId('settings-page').boundingBox())?.y ?? -1)).toBe(0);
      await page.screenshot({ path: info.outputPath(`settings-${width}-${scheme}.png`) });
    }
  }
});
test('all three environment roles expose editable protocol, reasoning and advanced settings in aligned cards', async ({ page }, info) => {
  let environment = WebEnvironmentSchema.parse({ schemaVersion: 1, canEditModels: true, settings: { schemaVersion: 1, solver: profile, verifier: profile, backup: profile }, accessTokens: { solver: 'synthetic-solver-token', verifier: 'synthetic-verifier-token', backup: 'synthetic-backup-token' } });
  let saves = 0;
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: environment }));
  await page.route('**/__solveflow/web-env/settings', async route => {
    const update = WebModelUpdateSchema.parse(route.request().postDataJSON()); saves++;
    expect(update.keys).toEqual({ solver: null, verifier: null, backup: null });
    expect(update.models.verifier).toMatchObject({ api: 'openai-responses', thinking: { mode: 'on', effort: 'high' }, maxTokens: 4096, streaming: false });
    expect(update.models.backup?.model).toBe('edited-backup');
    environment = WebEnvironmentSchema.parse({ ...environment, settings: { schemaVersion: 1, ...update.models } });
    await route.fulfill({ json: environment });
  });
  await page.goto('/'); await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  for (const role of ['解题', '校验', '备用']) await expect(page.getByLabel(`${role}模型引用名`, { exact: true })).toBeEditable();
  await page.getByLabel('备用模型引用名', { exact: true }).fill('edited-backup');
  const verifier = page.getByRole('region', { name: '校验模型', exact: true });
  await verifier.getByRole('button', { name: 'Responses', exact: true }).click(); await verifier.getByRole('button', { name: '开启', exact: true }).click(); await verifier.getByRole('button', { name: '高', exact: true }).click();
  await page.getByRole('button', { name: '校验高级参数', exact: true }).click(); await verifier.getByRole('button', { name: '非流式', exact: true }).click(); await page.getByLabel('校验最大输出 tokens', { exact: true }).fill('4096');
  await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(saves).toBe(1);
  await page.reload(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(verifier.getByRole('button', { name: 'Responses', exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(verifier.getByRole('button', { name: '高', exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByLabel('备用模型引用名', { exact: true })).toHaveValue('edited-backup');
  await expect(page.getByRole('button', { name: '使用 GPT-6 Sol 预设', exact: true })).toHaveCount(0);
  await expect(page.getByText(/服务地址填写 API Base URL/)).toHaveCount(0);
  await expect(page.getByTestId('settings-solver').getByRole('button', { name: '高', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '解题高级参数', exact: true }).click();
  for (const role of ['解题', '校验', '备用']) await expect(page.getByRole('button', { name: `${role}高级参数`, exact: true })).toHaveAttribute('aria-expanded', 'true');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(async () => Math.round((await page.getByTestId('settings-page').boundingBox())?.y ?? -1)).toBe(0);
      const preferences = await page.getByTestId('settings-preferences').getByRole('region').all();
      const preferenceBoxes = await Promise.all(preferences.map(card => card.boundingBox()));
      expect(Math.abs(preferenceBoxes[0]!.y - preferenceBoxes[1]!.y)).toBeLessThan(.5);
      expect(Math.abs(preferenceBoxes[0]!.height - preferenceBoxes[1]!.height)).toBeLessThan(.5);
      for (const field of ['服务地址', '供应商标识', '模型引用名', 'API Key', '上下文容量', '最大输出 tokens']) {
        const boxes = await Promise.all(['解题', '校验', '备用'].map(role => page.getByLabel(`${role}${field}`, { exact: true }).boundingBox()));
        expect(Math.max(...boxes.map(box => box!.y)) - Math.min(...boxes.map(box => box!.y))).toBeLessThan(.5);
      }
      const cards = await Promise.all(['解题模型', '校验模型', '备用解题模型'].map(name => page.getByRole('region', { name, exact: true }).boundingBox()));
      expect(Math.max(...cards.map(box => box!.height)) - Math.min(...cards.map(box => box!.height))).toBeLessThan(.5);
      const connections = await Promise.all(['解题', '校验', '备用'].map(role => page.getByRole('button', { name: `测试${role}模型连接`, exact: true }).boundingBox()));
      expect(Math.max(...connections.map(box => box!.y)) - Math.min(...connections.map(box => box!.y))).toBeLessThan(.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`three-role-settings-${width}-${scheme}.png`), fullPage: true });
    }
  }
  await page.getByRole('button', { name: '备用高级参数', exact: true }).click();
  for (const role of ['解题', '校验', '备用']) await expect(page.getByRole('button', { name: `${role}高级参数`, exact: true })).toHaveAttribute('aria-expanded', 'false');
});
