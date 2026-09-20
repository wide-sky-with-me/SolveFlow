import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BootstrapSchema, RunViewSchema } from "../packages/contracts/dist/http.js";
if (!process.argv.includes("--live")) throw new Error("Explicit --live required");
loadEnvFile(".env");
const origin = "http://127.0.0.1:3100";
const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? "/usr/bin/google-chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const report = { schemaVersion: 1, mode: "live", startedAt: new Date().toISOString(), fixture: "self-authored q1:3x-4=11,x=5; q2:2x+3=9,x=3", runs: [], passed: false };
let sessionId;
try {
  const fixture = await context.newPage(); await fixture.setViewportSize({ width: 900, height: 250 });
  await fixture.setContent('<html lang="zh"><body style="margin:30px;font:30px/1.8 sans-serif;background:white;color:black"><p>第1题：解方程 3x − 4 = 11。</p><p>第2题：解方程 2x + 3 = 9。</p></body></html>');
  const image = await fixture.screenshot(); await fixture.close();
  const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.name));
  const initialized = page.waitForResponse(response => response.url() === `${origin}/api/v1/bootstrap`);
  await page.goto(origin); const service = BootstrapSchema.parse(await (await initialized).json()); assert.equal(service.mode, "live"); assert(service.solvingAvailable);
  await page.getByLabel("从相册上传图片").setInputFiles({ name: "self-authored-two-questions.png", mimeType: "image/png", buffer: image });
  await page.getByLabel("补充说明").fill("请解答第1题和第2题，分别说明必要步骤与结论。");
  const normalized = value => value.replace(/[\\{}\s$]/g, "");
  async function complete(action, root) {
    const posted = page.waitForResponse(response => /\/sessions\/[^/]+\/runs$/.test(response.url()) && response.request().method() === "POST");
    const start = Date.now(); await action(); const response = await posted; assert.equal(response.status(), 202);
    let run = RunViewSchema.parse(await response.json()); sessionId = run.sessionId;
    while (!run.outcome && Date.now() - start < 130000) { await new Promise(resolve => setTimeout(resolve, 500)); run = RunViewSchema.parse(await (await context.request.get(`${origin}/api/v1/runs/${run.id}`)).json()); }
    const row = { id: run.id, status: run.status, verified: run.outcome?.verified, contextKind: run.context?.kind ?? null, elapsedMs: Date.now() - start, ...(run.outcome?.status === "failed" ? { errorCode: run.outcome.error.code } : {}) };
    report.runs.push(row); console.log(JSON.stringify(row));
    assert.equal(run.outcome?.status, "completed"); assert(run.outcome.verified);
    if (root !== undefined) { assert.match(normalized(run.outcome.candidate.answer), new RegExp(`x=${root}(?:$|[^0-9.])`)); assert.equal(root === 5 ? 3 * root - 4 : 2 * root + 3, root === 5 ? 11 : 9); }
    await page.reload(); await page.getByRole("region", { name: "第2题解答", exact: true }).waitFor();
    return run;
  }
  const first = await complete(() => page.getByRole("button", { name: "开始解题" }).click());
  const groups = first.outcome.candidate.questions; assert.deepEqual(groups?.map(group => group.number), [1, 2]);
  assert.match(normalized(groups[0].answer), /x=5(?:$|[^0-9.])/); assert.match(normalized(groups[1].answer), /x=3(?:$|[^0-9.])/);
  const q1 = page.getByRole("region", { name: "第1题解答", exact: true }); const q2 = page.getByRole("region", { name: "第2题解答", exact: true });
  await q2.getByLabel("继续问第2题").fill("这一题x是多少？请再解释移项的依据。");
  const second = await complete(() => q2.getByRole("button", { name: "发送第2题追问" }).click(), 3);
  await q1.getByLabel("继续问第1题").fill("这一题x是多少？请代回检验。");
  await complete(() => q1.getByRole("button", { name: "发送第1题追问" }).click(), 5);
  await q2.getByLabel("继续问第2题").fill("为什么两边要同时除以2？最后x是多少？");
  const continued = await complete(() => q2.getByRole("button", { name: "发送第2题追问" }).click(), 3);
  assert.deepEqual(continued.context, { kind: "reply", sourceRunId: second.id });
  assert.equal(await page.locator(".question-conversation").count(), 2);
  assert.equal(await q1.locator(".answer-card").count(), 2); assert.equal(await q2.locator(".answer-card").count(), 3);
  await page.setViewportSize({ width: 320, height: 700 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(errors, []);
  await mkdir(".runtime/screenshots", { recursive: true }); await page.screenshot({ path: ".runtime/screenshots/question-thread-live-mobile.png", fullPage: true }); report.passed = true;
} catch { report.failure = "QUESTION_THREAD_LIVE_FAILED"; process.exitCode = 1; }
finally {
  if (sessionId) report.fixtureDeleted = (await context.request.delete(`${origin}/api/v1/sessions/${sessionId}`, { headers: { origin } })).ok();
  await browser.close(); report.finishedAt = new Date().toISOString(); await mkdir(".runtime", { recursive: true });
  const data = JSON.stringify(report, null, 2) + "\n";
  await writeFile(`.runtime/question-thread-live-${report.startedAt.replace(/[:.]/g, "-")}.json`, data, { mode: 0o600 }); await writeFile(".runtime/question-thread-live.json", data, { mode: 0o600 }); console.log(data);
}
