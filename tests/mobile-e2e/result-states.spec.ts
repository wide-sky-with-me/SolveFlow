import { seedLocalSession } from './local-fixture.js';
import { test, expect } from "@playwright/test";
import { SessionViewSchema } from "../../packages/contracts/src/http.js";
import { makeSafeAgentError, policyRefusal } from "../../packages/contracts/src/agent.js";

// Presentation-only contract fixtures. Database/Pi scenarios are tested separately
// in app.integration.test.ts; none of these responses enter the actual service.
for (const state of ["unknown", "clarification", "policy", "emergency", "budget", "cancelled"] as const) {
  test(`renders ${state} safely with keyboard access and narrow formulas (UI fixture)`, async ({ page }) => {
    const image = await page.screenshot({ type: "jpeg" });
    const sessionId = "c7a188e2-1331-423e-b1b0-f6c273826720";
    const runId = "6d1a700f-d804-4347-9919-ec4e23a07b8a";
    const uploadId = "60aafc09-e48c-4b90-8c0b-bcb03da79346";
    const common = { schemaVersion: 1, problem: { text: "2x+3=7", subject: "math", uncertainties: [] }, knowledgePoints: [], citationIds: [] };
    const outcome = state === "unknown" ? { schemaVersion: 1, status: "completed", verified: false, warning: null,
      verification: { schemaVersion: 1, verdict: "unknown", checked: [], issues: [{ code: "INSUFFICIENT_EVIDENCE", message: "无法确认条件" }] },
      candidate: { ...common, kind: "answer", answer: "x = 2", clarificationQuestions: [], steps: [{ id: "s1", title: "检查等式", explanation: "<script>alert(1)</script> 不应执行", latex: "x=\\underbrace{1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1}_{\\text{长公式示例}}" }] } }
      : state === "policy" || state === "emergency" ? { schemaVersion: 1, status: "needs_clarification", verified: false, candidate: policyRefusal(state) }
      : state === "clarification" ? { schemaVersion: 1, status: "needs_clarification", verified: false, candidate: { ...common, kind: "clarification", answer: null, steps: [], clarificationQuestions: ["请补齐题目右侧的条件。"] } }
        : { schemaVersion: 1, status: state === "budget" ? "failed" : "cancelled", verified: false, error: makeSafeAgentError(state === "budget" ? "SPEND_LIMIT" : "CANCELLED", runId) };
    const session = SessionViewSchema.parse({ schemaVersion: 1, id: sessionId, subject: "math", createdAt: new Date().toISOString(),
      upload: { schemaVersion: 1, id: uploadId, mimeType: "image/jpeg", bytes: 100, width: 400, height: 100, expiresAt: new Date(Date.now() + 3600000).toISOString(), previewUrl: `/api/v1/uploads/${uploadId}/image` },
      runs: [{ schemaVersion: 1, id: runId, sessionId, status: outcome.status, message: "", seq: 5, createdAt: new Date().toISOString(), outcome }] });
    let dialogs = 0; page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
    await seedLocalSession(page, session, image);
    if (state === "unknown") {
      await expect(page.getByText("当前结果未通过完整校验，请结合题目检查后再使用。")).toBeVisible();
      await expect(page.getByText("模型独立校验通过", { exact: true })).toHaveCount(0);
      await expect(page.locator(".answer-document script")).toHaveCount(0);
    } else if (state === "clarification") await expect(page.getByText("请补齐题目右侧的条件。")).toBeVisible();
    else if (state === "policy" || state === "emergency") {
      await expect(page.getByRole("heading", { name: "本次请求无法解答" })).toBeVisible();
      await expect(page.locator(".final-answer")).toHaveCount(0);
      await expect(page.locator(".clarification")).toContainText(state === "policy" ? "学习题目" : "当地急救");
    }
    else if (state === "budget") {
      await expect(page.getByText("解题额度不足，请先核对服务额度，再重新发起解题。")).toBeVisible();
      await expect(page.getByText("错误代码：SPEND_LIMIT", { exact: true })).toBeVisible();
    }
    else await expect(page.getByRole("heading", { name: "本次解题已取消" })).toBeVisible();
    if (state === 'budget' || state === 'cancelled') {
      await page.getByRole('button', { name: '查看原图', exact: true }).click();
      await expect(page.getByRole('img', { name: '原始题图大图', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '关闭大图', exact: true }).click();
    }
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("tab", { name: "我的", exact: true }).click(); const help = page.getByRole("button", { name: "使用说明" }); await help.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible(); await page.getByRole("button", { name: "明白了" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible(); expect(dialogs).toBe(0);
  });
}
test("shows save-only mode without configured models", async ({ page }) => {
  await page.goto("/"); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: '题目', exact: true }).click(); await expect(page.getByRole('button', { name: '从相册选择', exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始解题" })).toHaveCount(0);
});
