import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BootstrapSchema, RunViewSchema } from "../packages/contracts/dist/http.js";

// Self-authored fixture; never part of offline CI. Does not touch student sessions.
if (!process.argv.includes("--live")) throw new Error("Explicit --live required");
loadEnvFile(".env");
const origin = "http://127.0.0.1:3100";
const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? "/usr/bin/google-chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const report = { schemaVersion: 1, mode: "live", fixture: "self-authored four questions, algebra/quadratic/probability/rectangle", startedAt: new Date().toISOString(), passed: false };
let sessionId;
try {
  const fixture = await context.newPage();
  await fixture.setViewportSize({ width: 900, height: 620 });
  await fixture.setContent('<html lang="zh"><body style="margin:36px;font:26px/1.8 sans-serif;color:#111;background:white"><h2>四道自编练习</h2><p>第1题：解方程 3x − 4 = 11。</p><p>第2题：求函数 y = x² − 4x + 3 的顶点和零点，画坐标图并标出顶点及零点。</p><p>第3题：袋中有3个红球、2个蓝球，任取1球，各球等可能。求取到红球的概率。</p><p>第4题：长方形长8厘米、宽5厘米。求面积和周长。</p></body></html>');
  const image = await fixture.screenshot({ type: "png" }); await fixture.close();
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.name));
  const bootstrap = page.waitForResponse(response => response.url() === `${origin}/api/v1/bootstrap`);
  await page.goto(origin);
  const service = BootstrapSchema.parse(await (await bootstrap).json()); assert.equal(service.mode, "live"); assert(service.solvingAvailable);
  await page.getByLabel("从相册上传图片").setInputFiles({ name: "self-authored-four-questions.png", mimeType: "image/png", buffer: image });
  await page.getByLabel("补充说明").fill("请解答第1–4题，每题说明方法、关键推导和结论；第2题画图。按题分开讲解。");
  const submitted = page.waitForResponse(response => /\/sessions\/[^/]+\/runs$/.test(response.url()) && response.request().method() === "POST");
  const started = Date.now(); await page.getByRole("button", { name: "开始解题" }).click();
  const response = await submitted; assert.equal(response.status(), 202);
  let run = RunViewSchema.parse(await response.json()); sessionId = run.sessionId;
  while (!["completed", "failed", "cancelled", "needs_clarification"].includes(run.status) && Date.now() - started < 130000) {
    await new Promise(resolve => setTimeout(resolve, 700));
    run = RunViewSchema.parse(await (await context.request.get(`${origin}/api/v1/runs/${run.id}`)).json());
  }
  report.runId = run.id; report.status = run.status; report.elapsedMs = Date.now() - started;
  if (run.outcome?.status === "failed") report.error = run.outcome.error.code;
  assert.equal(run.outcome?.status, "completed"); assert.equal(run.outcome.verified, true);
  const candidate = run.outcome.candidate;
  assert.deepEqual(candidate.questions?.map(question => question.number), [1, 2, 3, 4]);
  const answer = n => candidate.questions.find(question => question.number === n).answer.replace(/[\\{}\s$]/g, "");
  assert.match(answer(1), /x=5/); assert.equal(3 * 5 - 4, 11);
  assert.match(answer(2), /2[,，]-1/); assert.match(answer(2), /1/); assert.match(answer(2), /3/);
  const plot = candidate.figures.find(figure => candidate.questions[1].figureIds.includes(figure.id)); assert(plot);
  assert(plot.elements.some(element => element.kind === "polynomial" && JSON.stringify(element.coefficients) === "[3,-4,1]"));
  for (const at of [[1, 0], [3, 0], [2, -1]]) assert(plot.elements.some(element => element.kind === "point" && JSON.stringify(element.at) === JSON.stringify(at)));
  assert.match(answer(3), /(?:frac35|3\/5|0\.6|60%)/); assert.equal(3 / (3 + 2), 0.6);
  assert.match(answer(4), /40/); assert.match(answer(4), /26/); assert.equal(8 * 5, 40); assert.equal(2 * (8 + 5), 26);
  for (const question of candidate.questions) assert(question.stepIds.length >= 2);
  await page.locator(".question-section").first().waitFor(); assert.equal(await page.locator(".question-section").count(), 4);
  assert.equal(await page.getByRole("region", { name: "第2题解答", exact: true }).locator(".answer-figure").count(), candidate.questions[1].figureIds.length);
  await mkdir(".runtime/screenshots", { recursive: true });
  await page.screenshot({ path: ".runtime/screenshots/multi-live-desktop.png", fullPage: true });
  for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await page.screenshot({ path: ".runtime/screenshots/multi-live-mobile.png", fullPage: true });
  await page.reload(); await page.locator(".question-section").first().waitFor(); assert.equal(await page.locator(".question-section").count(), 4);
  assert.deepEqual(errors, []);
  report.verified = true; report.questions = candidate.questions.map(question => ({ number: question.number, steps: question.stepIds.length, figures: question.figureIds.length }));
  report.checks = ["real upload/API/worker/Solver/Verifier", "four independent mathematical truths", "quadratic coefficients and all three coordinates", "question ownership", "desktop/mobile390/mobile320/reload"];
  report.passed = true;
} catch (error) { report.failure = "MULTI_QUESTION_ACCEPTANCE_FAILED"; process.exitCode = 1; }
finally {
  if (sessionId) { const deleted = await context.request.delete(`${origin}/api/v1/sessions/${sessionId}`, { headers: { origin } }); report.fixtureDeleted = deleted.ok(); }
  await browser.close(); report.finishedAt = new Date().toISOString();
  await mkdir(".runtime", { recursive: true }); await writeFile(".runtime/multi-question-live.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
