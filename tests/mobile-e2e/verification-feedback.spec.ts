import { expect, test } from '@playwright/test';
import { makeSafeAgentError } from '../../packages/contracts/src/agent.js';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';
const id = '96000000-0000-4000-8000-000000000001';
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'Find x in the diagram.', subject: 'math', uncertainties: ['横轴最左侧刻度无法区分 0 和 1。'] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
for (const kind of ['timeout', 'invalid', 'fail', 'unknown', 'manual-timeout'] as const) {
  test(`explains ${kind} using recorded reasons, survives reload, and keeps unsafe markup inert`, async ({ page }) => {
    const image = await page.screenshot({ type: 'jpeg' }); const now = new Date().toISOString();
    const hasIssues = kind === 'fail' || kind === 'unknown';
    const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now,
      upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
      runs: [{ schemaVersion: 1, id, sessionId: id, createdAt: now, seq: 1, status: 'completed', message: '', outcome: { schemaVersion: 1, status: 'completed', candidate, verified: false,
        warning: hasIssues || kind === 'manual-timeout' ? null : kind === 'invalid' ? 'MODEL_OUTPUT_INVALID' : 'MODEL_TIMEOUT',
        ...(kind === 'manual-timeout' ? { verificationStatus: 'not_requested' } : {}),
        verification: hasIssues ? { schemaVersion: 1, verdict: kind, checked: ['transcription'], issues: [{ code: 'DIAGRAM', message: '候选按最小值 1 计算；请确认图中左端点是否在 0。<img src=x onerror=alert(1)>' }] } : null } },
        ...(kind === 'manual-timeout' ? [{ schemaVersion: 1, id: '96000000-0000-4000-8000-000000000002', sessionId: id, createdAt: now, seq: 1, status: 'failed', message: '', context: { kind: 'verification', sourceRunId: id }, outcome: { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('MODEL_TIMEOUT', id) } }] : [])] });
    await seedLocalSession(page, session, image);
    for (let attempt = 0; attempt < 2; attempt++) {
      const panel = page.getByRole('region', { name: '校验说明', exact: true });
      await expect(panel).toContainText(kind === 'invalid' ? '校验结果无法读取' : kind === 'fail' ? '校验发现疑点' : kind === 'unknown' ? '校验无法确认' : '校验超时');
      if (hasIssues) { await expect(panel).toContainText('图形或读图'); await expect(panel).toContainText('左端点是否在 0'); await expect(panel.locator('img')).toHaveCount(0); }
      else { await expect(panel).toContainText(kind === 'invalid' ? '无法据此判断答案对错' : '本次校验结论'); await expect(panel).not.toContainText('校验发现疑点'); }
      await expect(page.getByText('横轴最左侧刻度无法区分 0 和 1。', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '识别有误？更正题干', exact: true })).toBeVisible();
      if (attempt === 0) await page.reload();
    }
  });
}
