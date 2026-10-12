import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelSse } from './local-fixture.js';

// Simulated provider output verifies execution/persistence/UI, not reading accuracy.
for (const complete of [false, true]) {
  test(`manual multipart verification requires all parts and survives reload (complete: ${complete})`, async ({ page }) => {
    let calls = 0; const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'Compute (a) and (b).', subject: 'math', uncertainties: [], response: { type: 'multipart', parts: ['(a)', '(b)'] } }, answer: '两项结果如下。', parts: [{ label: '(a)', answer: '第一问结果：2。' }, { label: '(b)', answer: '第二问结果：4。' }], steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    const verification = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'arithmetic'], issues: [], coverage: (complete ? ['(a)', '(b)'] : ['(a)']).map(partLabel => ({ partLabel, verdict: 'pass', checked: ['transcription', 'arithmetic'] })) };
    await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
      const body: unknown = route.request().postDataJSON(); calls++;
      if (calls === 2) { expect(lastModelInput(body)).toMatchObject({ role: 'verifier', candidate: { parts: candidate.parts } }); expect(body).not.toHaveProperty('tools'); }
      await route.fulfill({ contentType: 'text/event-stream', body: modelSse(calls === 1 ? candidate : verification, body) });
    });
    await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
    await page.getByRole('button', { name: '开始解题', exact: true }).click();
    await expect(page.getByText('第二问结果：4。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '校验', exact: true }).click();
    await expect(page.getByRole('button', { name: complete ? '校验通过' : '无法确认', exact: true })).toBeVisible();
    if (!complete) {
      await expect(page.getByText('逐题或逐小问核验与候选的题号、原小问标签不完整对应，尚不能确认全部作答正确。', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '校验通过', exact: true })).toHaveCount(0);
    }
    expect(calls).toBe(2);
    await page.reload();
    await expect(page.getByRole('button', { name: complete ? '校验通过' : '无法确认', exact: true })).toBeVisible();
    await expect(page.getByText('第二问结果：4。', { exact: true })).toBeVisible();
    expect(calls).toBe(2);
    expect(errors).toEqual([]);
  });
}
