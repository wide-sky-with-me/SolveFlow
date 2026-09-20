import assert from "node:assert/strict";
import { complexProblemImage, assertComplexAnswer } from "./complex-problem.mjs";
import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createProbeImage } from "../packages/agent/dist/application.js";
import { BootstrapSchema, RunViewSchema, SessionViewSchema, parseRunEvent } from "../packages/contracts/dist/http.js";

// This command is deliberately excluded from pnpm test/test:e2e and CI.
if (!process.argv.includes("--live")) {
  console.error("Explicit --live required; this browser test creates paid model requests. Run m1:preflight first.");
  process.exitCode = 1;
} else {
  loadEnvFile(".env");
  const origin = "http://127.0.0.1:3100";
  const complex = process.argv.includes("--complex");
  const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? "/usr/bin/google-chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.name));
  const report = { schemaVersion: 1, mode: "live", startedAt: new Date().toISOString(), fixture: complex ? "self-authored quadratic x²-4x+3; vertex (2,-1); roots 1,3; intersections y=3 at x=0,4; area 32/3" : "self-authored 2x+3=7; ground truth x=2", checks: [], runs: [] };
  let sessionId;
  try {
    const fixturePage = await context.newPage();
    const problemImage = complex ? await complexProblemImage(fixturePage) : Buffer.from(createProbeImage());
    await fixturePage.close();
    const bootstrap = page.waitForResponse(response => response.url() === `${origin}/api/v1/bootstrap`);
    await page.goto(origin);
    const service = BootstrapSchema.parse(await (await bootstrap).json());
    assert.equal(service.mode, "live"); assert.equal(service.solvingAvailable, true);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "从相册选择" }).click();
    await (await chooser).setFiles({ name: "m1-self-authored.png", mimeType: "image/png", buffer: problemImage });
    await page.getByRole("button", { name: "使用这张题图" }).click();
    await page.getByLabel("补充说明").fill(complex ? "请解答原题并给出坐标图和必要公式，解答中附原题图供对照。" : "请解答图片中的一道题，给出清晰的教学步骤。");
    async function completeRun(action) {
      const submitted = page.waitForResponse(response => /\/sessions\/[^/]+\/runs$/.test(response.url()) && response.request().method() === "POST");
      const started = Date.now(); await action();
      const response = await submitted; assert.equal(response.status(), 202);
      const queued = RunViewSchema.parse(await response.json()); sessionId = queued.sessionId;
      let run = queued;
      while (!["completed", "needs_clarification", "failed", "cancelled"].includes(run.status) && Date.now() - started < 130_000) {
        await new Promise(resolve => setTimeout(resolve, 500));
        run = RunViewSchema.parse(await (await context.request.get(`${origin}/api/v1/runs/${queued.id}`)).json());
      }
      report.runs.push({ id: run.id, status: run.status, verified: run.outcome?.verified, elapsedMs: Date.now() - started,
        ...(run.outcome?.status === "failed" ? { error: run.outcome.error.code } : {}) });
      assert.equal(run.status, "completed", `RUN_FAILED:${run.outcome?.status === "failed" ? run.outcome.error.code : run.status}`);
      assert.equal(run.outcome?.verified, true);
      const eventsResponse = await context.request.get(`${origin}/api/v1/runs/${run.id}/events`);
      assert.equal(eventsResponse.status(), 200);
      const events = (await eventsResponse.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => parseRunEvent(JSON.parse(line.slice(6))));
      assert.deepEqual(events.map(event => event.seq), Array.from({ length: run.seq }, (_, index) => index + 1));
      assert.equal(events.at(-1)?.type, "run.done");
      assert(events.some(event => event.type === "run.status" && event.status === "verifying"));
      report.runs.at(-1).tools = [...new Set(events.filter(event => event.type === "tool.status" && event.status === "completed").map(event => event.toolName))];
      const replay = await context.request.get(`${origin}/api/v1/runs/${run.id}/events?after=${run.seq - 1}`);
      assert.equal((await replay.text()).split("\n").filter(line => line.startsWith("data: ")).length, 1);
      return run;
    }
    const first = await completeRun(() => page.getByRole("button", { name: "开始解题" }).click());
    const normalized = first.outcome.candidate.answer.replace(/[\\{}\s$]/g, "");
    if (complex) {
      await writeFile(".runtime/complex-answer.json", JSON.stringify(first.outcome, null, 2) + "\n", { mode: 0o600 });
      assertComplexAnswer(assert, first.outcome);
      await page.locator(".answer-figure svg").first().waitFor();
      assert(await page.locator(".katex").count() > 0);
      await page.getByRole("button", { name: "展开原始题图" }).click();
      const original = page.getByRole("img", { name: "待解答的题目" }); await original.waitFor();
      assert(await original.evaluate(node => node.complete && node.naturalWidth > 0));
      await page.getByRole("button", { name: "收起原始题图" }).click();
      report.checks.push("independent quadratic truth / verified diagram / KaTeX / authorized original image");
    } else { assert.match(normalized, /x=2(?:$|[^0-9.])/); assert.equal(2 * 2 + 3, 7); }
    report.checks.push("real upload/queue/Solver/Verifier/PASS/ground-truth/SSE-replay");
    if (process.argv.includes("--followup")) {
      await page.getByLabel("继续问这道题").fill("为什么等式两边都可以减去3？请结合原题解释。");
      await completeRun(() => page.getByRole("button", { name: "发送同题追问" }).click());
      report.checks.push("real follow-up with original image and stored history");
    }
    const sessionUrl = page.url();
    report.subject = first.outcome.candidate.problem.subject;
    const finalHeading = process.argv.includes("--followup") ? "追问解答" : "答案与解析";
    await page.reload(); await page.getByRole("heading", { name: finalHeading }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mkdir(".runtime/screenshots", { recursive: true });
    await page.screenshot({ path: ".runtime/screenshots/m1-live-desktop.png", fullPage: true });
    const session = SessionViewSchema.parse(await (await context.request.get(`${origin}/api/v1/sessions/${sessionId}`)).json());
    assert.equal(session.subject, first.outcome.candidate.problem.subject);
    const outsider = await browser.newContext();
    try {
      await outsider.request.post(`${origin}/api/v1/bootstrap`, { headers: { origin } });
      for (const path of [`/sessions/${sessionId}`, session.upload.previewUrl.replace("/api/v1", ""), `/runs/${first.id}/events`]) {
        assert.equal((await outsider.request.get(`${origin}/api/v1${path}`)).status(), 404);
      }
    } finally { await outsider.close(); }
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
    try {
      const phone = await mobile.newPage(); await phone.goto(sessionUrl);
      await phone.getByRole("heading", { name: finalHeading }).waitFor();
      for (const width of [390, 320]) { await phone.setViewportSize({ width, height: 844 }); assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
      await phone.screenshot({ path: ".runtime/screenshots/m1-live-mobile.png", fullPage: true });
      await phone.getByRole("button", { name: "删除这道题" }).click();
      await phone.getByRole("button", { name: "确认删除" }).click();
      await phone.getByRole("button", { name: "拍一张" }).waitFor();
    } finally { await mobile.close(); }
    assert.equal((await context.request.get(`${origin}/api/v1/sessions/${sessionId}`)).status(), 404);
    assert.equal((await context.request.get(`${origin}${session.upload.previewUrl}`)).status(), 404);
    assert.deepEqual(errors, []); report.checks.push("refresh/desktop/mobile390/mobile320/cross-owner/deletion");
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = error instanceof Error && /^RUN_FAILED:[A-Z_]+$/.test(error.message) ? error.message : "LIVE_ACCEPTANCE_ASSERTION_FAILED";
    process.exitCode = 1;
  } finally {
    if (sessionId) await context.request.delete(`${origin}/api/v1/sessions/${sessionId}`, { headers: { origin } }).catch(() => {});
    await browser.close(); report.finishedAt = new Date().toISOString();
    await mkdir(".runtime", { recursive: true });
    await writeFile(`.runtime/m1-live-acceptance-${report.startedAt.replace(/[:.]/g, "-")}.json`, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    await writeFile(".runtime/m1-live-acceptance.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  }
}
