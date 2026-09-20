import { seedLocalSession } from './local-fixture.js';
import { test, expect } from "@playwright/test";
import { SessionViewSchema } from "../../packages/contracts/src/http.js";

test("renders model formulas, tables, authorized images and diagrams safely at 320px (UI fixture)", async ({ page }, testInfo) => {
  const id = "c7a188e2-1331-423e-b1b0-f6c273826720";
  const uploadId = "60aafc09-e48c-4b90-8c0b-bcb03da79346";
  const image = await page.screenshot({ type: "jpeg" });
  const imageUrl = `/api/v1/uploads/${uploadId}/image`;
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: "physics", createdAt: new Date().toISOString(),
    upload: { schemaVersion: 1, id: uploadId, mimeType: "image/jpeg", bytes: image.length, width: page.viewportSize()!.width, height: page.viewportSize()!.height, expiresAt: new Date(Date.now() + 3600000).toISOString(), previewUrl: imageUrl },
    runs: [{ schemaVersion: 1, id: "6d1a700f-d804-4347-9919-ec4e23a07b8a", sessionId: id, status: "completed", message: "", seq: 5, createdAt: new Date().toISOString(),
      outcome: { schemaVersion: 1, status: "completed", verified: true, warning: null, verification: { schemaVersion: 1, verdict: "pass", checked: ["transcription", "diagram"], issues: [] },
        candidate: { schemaVersion: 1, kind: "answer", problem: { text: "test", subject: "physics", uncertainties: [] },
          answer: "速度 **恒定**，行内 $v=2$。\n\n\\[s=2t\\]\n\n| 时间 | 位置 |\n| --- | --- |\n| 1 | 2 |\n\n![原题对照](attachment:original)\n\n![外部图](https://outside.invalid/track.png)\n\n[危险链接](javascript:alert(1))\n\n<script>alert(1)</script>",
          steps: [{ id: "s1", title: "公式兼容", explanation: "\\(x^2\\) 与 `\\(代码\\)`", latex: "\\href{javascript:alert(1)}{unsafe}" }, { id: "s2", title: "长公式", explanation: "检查长公式首尾均可阅读。", latex: "x_1+x_2+x_3+x_4+x_5+x_6+x_7+x_8+x_9+x_{10}=123456789" }], citationIds: [], knowledgePoints: [], clarificationQuestions: [],
          figures: [{ schemaVersion: 1, id: "motion", kind: "coordinate", title: "位置与时间", description: "位置随时间线性增加", xRange: [0, 5], yRange: [0, 10], elements: [{ kind: "polynomial", coefficients: [0, 2], label: "s=2t" }, { kind: "point", at: [1, 2], label: "一秒后" }] }] } } }] });
  let dialogs = 0; let externalRequests = 0;
  page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
  page.on("request", request => { if (request.url().includes("outside.invalid")) externalRequests++; });
  await seedLocalSession(page, session, image);
  await expect(page.getByRole("heading", { name: "答案", exact: true })).toBeVisible();
  await expect(page.getByText('题目与解答', { exact: true })).toHaveCount(0);
  await expect(page.getByText('答案与解析', { exact: true })).toHaveCount(0);
  expect(await page.locator('article.answer-document').evaluate(node => {
    const problem = node.querySelector('.problem-statement')!;
    const answer = node.querySelector('.final-answer')!;
    const steps = node.querySelector('.teaching-steps')!;
    return !!(problem.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(answer.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await expect(page.locator(".teaching-steps")).toBeHidden();
  const originalImage = await page.getByAltText("原题对照").elementHandle();
  await page.locator(".step-details>summary").click();
  // Allow the 50ms document resize report to update its native parent props.
  await page.waitForTimeout(200);
  expect(await originalImage!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator(".teaching-steps")).toBeVisible();
  await expect(page.locator(".math-inline .katex")).toHaveCount(2);
  await expect(page.locator(".answer-markdown .math-block .katex")).toHaveCount(1);
  await expect(page.locator(".answer-markdown table")).toBeVisible();
  await expect(page.getByAltText("原题对照")).toBeVisible();
  await page.getByAltText("原题对照").scrollIntoViewIfNeeded();
  await expect.poll(() => page.getByAltText("原题对照").evaluate(node => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
  await expect(page.locator(".step-details .answer-figure svg polyline")).toHaveCount(1);
  await expect(page.locator(".answer-markdown a")).toHaveCount(0);
  await expect(page.locator(".answer-markdown script")).toHaveCount(0);
  await expect(page.locator(".answer-markdown code").filter({ hasText: "\\(代码\\)" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  const formula = page.locator('.teaching-steps .math-block').last();
  await formula.scrollIntoViewIfNeeded();
  const edges = await formula.evaluate(node => {
    const ink = node.querySelector('.katex-html')!; const box = node.getBoundingClientRect();
    const start = ink.getBoundingClientRect().left; node.scrollLeft = node.scrollWidth;
    return { start, left: box.left, end: ink.getBoundingClientRect().right, right: box.right, width: node.clientWidth, scrollWidth: node.scrollWidth };
  });
  expect(edges.scrollWidth).toBeGreaterThan(edges.width);
  await expect(page.getByText("左右滑动查看完整公式")).toBeVisible();
  expect(edges.start).toBeGreaterThanOrEqual(edges.left);
  expect(edges.end).toBeLessThanOrEqual(edges.right + 1);
  await page.locator(".step-details").getByRole("button", { name: "放大图示" }).click();
  expect(await page.locator(".step-details .figure-viewport").evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "适应宽度" }).click();
  await page.screenshot({ path: `.runtime/screenshots/${testInfo.project.name}-rich-answer.png`, fullPage: true });
  expect(dialogs).toBe(0); expect(externalRequests).toBe(0);
});
