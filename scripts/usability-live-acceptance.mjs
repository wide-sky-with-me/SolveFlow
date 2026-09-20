import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BootstrapSchema, RunViewSchema, SessionViewSchema } from "../packages/contracts/dist/http.js";

// Self-authored fixture. Explicit opt-in only; never part of CI or offline tests.
if (!process.argv.includes("--live")) { console.error("Explicit --live required."); process.exitCode = 1; }
else {
  loadEnvFile(".env");
  const origin = "http://127.0.0.1:3100";
  const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? "/usr/bin/google-chrome" });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); let sessionId;
  const report = { schemaVersion: 1, mode: "live", startedAt: new Date().toISOString(), fixture: "self-authored ax+3=9; a supplied as 3 then corrected to 2; exact roots 2 and 3", runs: [], passed: false };
  try {
    const fixturePage = await context.newPage(); await fixturePage.setViewportSize({ width: 900, height: 250 });
    await fixturePage.setContent('<html lang="zh"><body style="margin:30px;font:30px sans-serif;background:white;color:black"><p>解关于 x 的方程：a x + 3 = 9。</p><p>系数 a 的数值待补充，请先确认。</p></body></html>');
    const image = await fixturePage.screenshot(); await fixturePage.close();
    const initialized = page.waitForResponse(response => response.url() === `${origin}/api/v1/bootstrap`);
    await page.goto(origin); const bootstrap = BootstrapSchema.parse(await (await initialized).json());
    assert.equal(bootstrap.mode, "live"); assert(bootstrap.solvingAvailable);
    await page.getByLabel("从相册上传图片").setInputFiles({ name: "self-authored-clarification.png", mimeType: "image/png", buffer: image });
    await page.getByLabel("补充说明").fill("a的数值我还没有补充，请先问我a是多少，确认后再给出数值解。");
    async function complete(action, expected, root) {
      const posted = page.waitForResponse(response => /\/sessions\/[^/]+\/runs$/.test(response.url()) && response.request().method() === "POST");
      const start = Date.now(); await action(); const response = await posted; assert.equal(response.status(), 202);
      let run = RunViewSchema.parse(await response.json()); sessionId = run.sessionId;
      while (!run.outcome && Date.now() - start < 130000) {
        await new Promise(resolve => setTimeout(resolve, 500));
        run = RunViewSchema.parse(await (await context.request.get(`${origin}/api/v1/runs/${run.id}`)).json());
      }
      const row = { id: run.id, status: run.status, verified: run.outcome?.verified, elapsedMs: Date.now() - start, contextKind: run.context?.kind ?? null,
        ...(run.outcome?.status === "failed" ? { errorCode: run.outcome.error.code } : {}) };
      report.runs.push(row); console.log(JSON.stringify(row));
      assert.equal(run.status, expected);
      if (expected === "completed") {
        assert.equal(run.outcome?.verified, true);
        if (root !== undefined) {
          const answer = run.outcome.candidate.answer.replace(/\\(?:boxed|frac|displaystyle|text|quad|left|right)/g, "").replace(/[\\{}\s$]/g, "");
          assert.match(answer, new RegExp(`x=${root}(?:$|[^0-9.])`));
          assert.equal((root === 2 ? 3 : 2) * root + 3, 9);
        }
      }
      await page.reload(); await page.locator(".answer-card").last().waitFor();
      return run;
    }
    await complete(() => page.getByRole("button", { name: "开始解题" }).click(), "needs_clarification");
    await page.getByLabel("补充上面的问题").fill("3");
    const solved = await complete(() => page.getByRole("button", { name: "发送同题追问" }).click(), "completed", 2);
    await page.locator(".answer-card").last().getByRole("button", { name: "识别有误？更正题干" }).click();
    await page.getByLabel("更正后的题干或补充说明").fill("系数a更正为2，其余条件不变：2x+3=9，求x。");
    const corrected = await complete(() => page.getByRole("button", { name: "按更正重新解答" }).click(), "completed", 3);
    assert.equal(corrected.context?.sourceRunId, solved.id);
    const selected = corrected.outcome.candidate.steps[0]; assert(selected);
    await page.locator(".answer-card").last().getByRole("button", { name: "这一步不懂" }).first().click();
    await page.getByLabel("还有哪一步想再问问？").fill("请解释这一处的依据，并写出等式两边的具体变化。");
    const followed = await complete(() => page.getByRole("button", { name: "发送同题追问" }).click(), "completed");
    assert.deepEqual(followed.context, { kind: "step", sourceRunId: corrected.id, stepId: selected.id });
    const saved = SessionViewSchema.parse(await (await context.request.get(`${origin}/api/v1/sessions/${sessionId}`)).json());
    assert.equal(saved.runs.length, 4); assert.deepEqual(saved.runs[1]?.outcome, solved.outcome);
    assert(await page.locator(".answer-card").count() === 4);
    await page.setViewportSize({ width: 320, height: 700 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mkdir(".runtime/screenshots", { recursive: true }); await page.screenshot({ path: ".runtime/screenshots/usability-live-mobile.png", fullPage: true });
    report.passed = true;
  } catch { report.failure = "LIVE_USABILITY_ASSERTION_FAILED"; process.exitCode = 1; }
  finally {
    if (sessionId) await context.request.delete(`${origin}/api/v1/sessions/${sessionId}`, { headers: { origin } }).catch(() => {});
    await browser.close(); report.finishedAt = new Date().toISOString();
    await mkdir(".runtime", { recursive: true });
    await writeFile(`.runtime/usability-live-${randomUUID()}.json`, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    await writeFile(".runtime/usability-live.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  }
}
