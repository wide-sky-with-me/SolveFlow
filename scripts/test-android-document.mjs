// Exercises the actual APK's local DOM assets with the locked Android initial-props
// injection. Chromium is not an Android device; native Yoga/WebView still needs testing.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { encodeHistoryDocument } from '../packages/client/dist/history-payload.js';
import { encodeAnswerDocument } from '../packages/client/dist/answer-payload.js';

const apk = resolve(process.argv[2] ?? '.runtime/artifacts/solveflow-arm64-local.apk');
const directory = await mkdtemp(join(tmpdir(), 'solveflow-apk-dom-'));
let browser;
try {
  execFileSync('unzip', ['-q', apk, 'assets/www.bundle/*', '-d', directory]);
  const assets = join(directory, 'assets/www.bundle');
  assert.ok(!(await readdir(assets, { recursive: true })).some(file => file.includes('noto-serif-sc')), 'No obsolete fixed reading font assets');
  const documents = (await readdir(assets)).filter(file => file.endsWith('.html'));
  assert.equal(documents.length, 3, 'Expected packaged answer, history and formula-preview documents');
  const referencedEntries = new Set();
  for (const file of documents) {
    const html = await readFile(join(assets, file), 'utf8');
    for (const match of html.matchAll(/_expo\/static\/js\/web\/(entry-[a-f0-9]+\.js)/g)) referencedEntries.add(match[1]);
  }
  const packagedEntries = (await readdir(join(assets, '_expo/static/js/web'))).filter(file => /^entry-.*\.js$/.test(file));
  assert.deepEqual(packagedEntries.sort(), [...referencedEntries].sort(), 'APK must not retain obsolete DOM entry bundles from earlier builds');
  browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome' });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  const image = `data:image/jpeg;base64,${(await page.screenshot({ type: 'jpeg' })).toString('base64')}`;
  const value = { schemaVersion: 1, runId: '10000000-0000-4000-8000-000000000003', image, width: 360, height: 800, number: null, disabled: false, showRegenerate: true,
    outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null,
      verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'diagram'], issues: [] },
      candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '已知函数 $y=x^2$，求 $x=2$ 时的值。', subject: 'math', uncertainties: [], illustrations: [{ id: 'source', alt: '原题示意图', x: .1, y: .1, width: .6, height: .6 }] },
        answer: '结果为 $4$。\n\n![原题对照](attachment:original)',
        steps: [{ id: 's1', title: '代入计算', explanation: '先看“自变量”\n再计算 "平方"。\n\n$\\sqrt{16}=4$\n\n` ${globalThis.untrustedExecuted = true} </script>', latex: 'x^2+2-2=6-2\\implies x^2=4' }],
        knowledgePoints: ['函数求值'], knowledgeDetails: [{ name: '函数求值', explanation: '将自变量代入对应关系。', application: '代入x=2求平方。' }], citationIds: [], clarificationQuestions: [],
        figures: [{ schemaVersion: 1, kind: 'coordinate', id: 'function', title: '函数图像', description: '抛物线', xRange: [-3, 3], yRange: [0, 9], elements: [{ kind: 'polynomial', coefficients: [0, 0, 1], label: 'y=x²' }] }] } } };
  const historySession = { schemaVersion: 1, id: value.runId, subject: 'math', createdAt: '2026-09-16T00:00:00.000Z', upload: { schemaVersion: 1, id: value.runId, mimeType: 'image/jpeg', bytes: 1, width: 360, height: 800, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${value.runId}/image` }, runs: [{ schemaVersion: 1, id: value.runId, sessionId: value.runId, status: 'completed', message: '', seq: 1, createdAt: '2026-09-16T00:00:00.000Z', outcome: value.outcome }] };
  const injected = { EXPO_DOM_HOST_OS: 'android', initialProps: { props: { previewPayload: encodeURIComponent('Compare 2 with $2$. 预览 $\\frac{x}{2}$，` ${globalThis.executed = true} </script>'), payload: encodeAnswerDocument(value), historyPayload: encodeHistoryDocument([historySession], value.runId, false, 20) }, names: ['onReady', 'onFocus', 'onCorrect', 'onOpen', 'onFavorite', 'onRemove', 'onViewOriginal', 'onRegenerate', 'onHeight', 'onVerify', 'onHistory', 'onRequestSteps', 'onCancelSteps'] } };
  // Reproduce the captured Android race: the message interface exists first,
  // while its injectedObjectJson accessor arrives only after navigation.
  const latePage = await browser.newPage();
  const startupErrors = [];
  latePage.on('pageerror', error => startupErrors.push(error.message));
  await latePage.addInitScript({ content: `window.ReactNativeWebView = {postMessage:function(){}};
    window.addEventListener('DOMContentLoaded', function(){window.ReactNativeWebView.injectedObjectJson=function(){return \`${JSON.stringify(injected)}\`;};});` });
  await latePage.goto(pathToFileURL(join(assets, documents[0])).href);
  await expect(latePage.locator('.answer-document')).toBeVisible();
  assert.deepEqual(startupErrors, [], 'Late native props must not crash the packaged entry');
  await latePage.close();

  // Locked RNCWebView only injects at onPageStarted for a non-empty early hook.
  const nativeConfiguration = await readFile(new URL('../apps/mobile/src/document-props.native.ts', import.meta.url), 'utf8');
  assert.match(nativeConfiguration, /injectedJavaScriptBeforeContentLoaded:\s*['"]true;['"]/);
  const messages = []; const errors = []; const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await page.exposeFunction('captureNativeMessage', message => messages.push(JSON.parse(message)));
  await page.addInitScript({ content: `window.ReactNativeWebView = {
    injectedObjectJson: function() { return \`${JSON.stringify(injected)}\`; },
    postMessage: function(message) {
      window.captureNativeMessage(message);
      const event = JSON.parse(message);
      if (event.type === '$$native_action') setTimeout(() => window.dispatchEvent(new CustomEvent('$$dom_event', {detail: {type:'$$native_action_result', data: {uid:event.data.uid, actionId:event.data.actionId, result:null}}})), 0);
    }
  };` });
  let answerFile; let historyChecked = false; let previewChecked = false;
  for (const file of documents) {
    await page.goto(pathToFileURL(join(assets, file)).href);
    await expect(page.locator('.answer-document')).toBeVisible();
    if (await page.locator('.math-preview').count()) {
      await expect(page.locator('.math-preview .katex')).toHaveCount(2);
      await page.evaluate(() => document.fonts.ready);
      const typography = await page.locator('.math-preview .answer-markdown p').evaluate(node => {
        const range = document.createRange(); const text = node.firstChild; const start = text.textContent.indexOf('2'); range.setStart(text, start); range.setEnd(text, start + 1); const prose = range.getBoundingClientRect();
        const symbol = node.querySelector('.katex-html .mord'); range.selectNodeContents(symbol); const math = range.getBoundingClientRect();
        const probe = () => { const span = document.createElement('span'); span.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline'; return span; };
        const proseProbe = probe(); const mathProbe = probe(); node.insertBefore(proseProbe, node.firstChild); node.querySelector('.katex-html').append(mathProbe);
        const baselineDelta = Math.abs(proseProbe.getBoundingClientRect().top - mathProbe.getBoundingClientRect().top); proseProbe.remove(); mathProbe.remove();
        return { proseFont: getComputedStyle(node).fontFamily.split(',')[0], mathFont: getComputedStyle(symbol).fontFamily.split(',')[0], proseSize: getComputedStyle(node).fontSize, mathSize: getComputedStyle(symbol).fontSize, glyphBottomDelta: Math.abs(prose.bottom - math.bottom), baselineDelta };
      });
      console.log('Packaged typography:', JSON.stringify(typography));
      assert.ok(!/KaTeX|SolveFlowReading/.test(typography.proseFont), 'Prose inherits the device face');
      assert.equal(typography.mathFont, 'KaTeX_Main', 'Preserve mathematical font metrics');
      assert.equal(typography.proseSize, typography.mathSize, 'Inline symbols retain the prose scale');
      assert.ok(typography.baselineDelta < 1, 'Inline math aligns with the actual prose baseline');
      const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument'); const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.math-preview .answer-markdown p' });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      assert.ok(fonts.length > 0 && fonts.every(font => !font.isCustomFont), 'Chinese and prose use installed system faces');
      await cdp.detach();
      assert.equal(await page.evaluate(() => 'executed' in globalThis), false);
      previewChecked = true;
    } else if (await page.locator('.history-document').count()) {
      await expect(page.locator('.history-preview .katex')).toHaveCount(2);
      await expect(page.locator('.history-ordinal')).toHaveText('序号 21');
      await expect(page.locator('.history-meta time')).toHaveAttribute('datetime', historySession.createdAt);
      await expect(page.locator('.history-meta time')).toHaveText(/^保存于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      await page.getByRole('button', { name: `打开数学题目 ${value.runId}` }).click();
      await expect.poll(() => messages.some(message => message.type === '$$native_action' && message.data.actionId === 'onOpen' && message.data.args[0] === value.runId)).toBe(true);
      await page.getByRole('button', { name: '题目操作', exact: true }).click();
      await page.getByRole('button', { name: '收藏', exact: true }).click();
      await expect.poll(() => messages.some(message => message.type === '$$native_action' && message.data.actionId === 'onFavorite' && message.data.args[0] === value.runId)).toBe(true);
      await page.getByRole('button', { name: '题目操作', exact: true }).click();
      await page.getByRole('button', { name: '移除', exact: true }).click();
      await expect.poll(() => messages.some(message => message.type === '$$native_action' && message.data.actionId === 'onRemove' && message.data.args[0] === value.runId)).toBe(true);
      historyChecked = true;
    } else answerFile = file;
  }
  assert.ok(historyChecked && previewChecked && answerFile, 'Both local documents boot and the history action crosses the bridge');
  // Android can suspend animation frames for offscreen/background WebViews.
  // A committed document must acknowledge readiness without waiting for a frame.
  const frozen = await browser.newPage(); const frozenMessages = [];
  await frozen.exposeFunction('captureNativeMessage', value => frozenMessages.push(JSON.parse(value)));
  await frozen.addInitScript({ content: `Object.defineProperty(document.fonts, 'ready', {get:function(){return new Promise(function(){});}}); window.requestAnimationFrame = function(){return 1;}; window.cancelAnimationFrame = function(){};
    window.ReactNativeWebView = {
      injectedObjectJson: function(){return \`${JSON.stringify(injected)}\`;},
      postMessage: function(message){window.captureNativeMessage(message);const event=JSON.parse(message);
        if(event.type==='$$native_action')setTimeout(()=>window.dispatchEvent(new CustomEvent('$$dom_event',{detail:{type:'$$native_action_result',data:{uid:event.data.uid,actionId:event.data.actionId,result:null}}})),0);}
    };` });
  await frozen.goto(pathToFileURL(join(assets, answerFile)).href);
  await expect(frozen.locator('.problem-statement .katex')).toHaveCount(2);
  await expect.poll(() => frozenMessages.some(message => message.type === '$$native_action' && message.data.actionId === 'onReady')).toBe(true);
  await frozen.close();
  // Brief answers projected from a multi-question run must initialize too.
  const briefPage = await browser.newPage(); const briefErrors = []; const briefMessages = [];
  briefPage.on('pageerror', error => briefErrors.push(error.message));
  await briefPage.exposeFunction('captureNativeMessage', message => briefMessages.push(JSON.parse(message)));
  const brief = structuredClone(value);
  brief.number = 2;
  brief.outcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null,
    candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '求 $x^2$ 在 $[-1,1]$ 上的定积分。', subject: 'math', uncertainties: [] }, answer: '由原函数代入上下限。**结果：$2/3$**', steps: [], figures: [], knowledgePoints: ['一元二次方程求解', '定积分与牛顿-莱布尼茨公式', '二次函数图像与单调性'], citationIds: [], clarificationQuestions: [] } };
  const briefInjected = { ...injected, initialProps: { ...injected.initialProps, props: { ...injected.initialProps.props, payload: encodeAnswerDocument(brief) } } };
  await briefPage.addInitScript({ content: `window.ReactNativeWebView = {
    injectedObjectJson: function(){return ${JSON.stringify(JSON.stringify(briefInjected))};},
    postMessage: function(message){window.captureNativeMessage(message);const event=JSON.parse(message);
      if(event.type==='$$native_action')setTimeout(()=>window.dispatchEvent(new CustomEvent('$$dom_event',{detail:{type:'$$native_action_result',data:{uid:event.data.uid,actionId:event.data.actionId,result:null}}})),0);}
  };` });
  await briefPage.goto(pathToFileURL(join(assets, answerFile)).href);
  await expect(briefPage.locator('.final-answer')).toContainText('结果');
  await expect.poll(() => briefMessages.some(message => message.type === '$$native_action' && message.data.actionId === 'onReady')).toBe(true);
  assert.deepEqual(briefErrors, []);
  await briefPage.close();
  const choicePage = await browser.newPage({ viewport: { width: 320, height: 844 } });
  const choice = structuredClone(brief); choice.number = null;
  choice.outcome.candidate.problem = { text: 'Choose the closest value.', subject: 'math', uncertainties: [], options: [{label:'F',text:'$1/2$'}, {label:'G',text:'$1$'}, {label:'H',text:'$2$'}, {label:'J',text:'A long alternative that wraps naturally without squeezing the original label.'}] };
  choice.outcome.candidate.selectedOptions = ['H']; choice.outcome.candidate.answer = 'The value is approximately $2$.';
  const choiceInjected = { ...injected, initialProps: { ...injected.initialProps, props: { ...injected.initialProps.props, payload: encodeAnswerDocument(choice) } } };
  await choicePage.addInitScript(value => { window.ReactNativeWebView = { injectedObjectJson: () => JSON.stringify(value), postMessage: () => {} }; }, choiceInjected);
  await choicePage.goto(pathToFileURL(join(assets, answerFile)).href);
  await expect(choicePage.locator('.final-answer h3')).toHaveText('答案：H');
  await expect(choicePage.locator('.choice-options li')).toHaveCount(4);
  await expect(choicePage.locator('.choice-options .choice-label')).toHaveText(['F','G','H','J']);
  await expect(choicePage.locator('.answer-explanation')).toContainText('The value is approximately');
  await expect(choicePage.locator('.katex-error')).toHaveCount(0);
  assert.equal(await choicePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await choicePage.close();

  messages.length = 0;
  await page.goto(pathToFileURL(join(assets, answerFile)).href);
  await expect(page.getByRole('region', { name: '题目原文' })).toContainText('已知函数');
  await expect(page.getByRole('heading', { name: '答案', exact: true })).toBeVisible();
  await expect(page.locator('.answer-document > .reading-card')).toHaveCount(4);
  await expect(page.locator('.problem-statement').getByRole('button', { name: '识别有误？更正题干' })).toBeVisible();
  await expect(page.locator('.teaching-steps')).toBeHidden();
  const collapsedHeight = () => messages.filter(message => message.type === '$$native_action' && message.data.actionId === 'onHeight').at(-1)?.data.args[0] ?? 0;
  await expect.poll(collapsedHeight).toBeGreaterThan(0);
  const closedHeight = collapsedHeight();
  await page.locator('.step-details>summary').click();
  await expect(page.locator('.teaching-steps')).toBeVisible();
  await expect.poll(collapsedHeight).toBeGreaterThan(closedHeight);
  await page.locator('.problem-heading').getByRole('button', { name: '查看原图' }).click();
  await expect.poll(() => messages.some(message => message.type === '$$native_action' && message.data.actionId === 'onViewOriginal')).toBe(true);
  await page.locator('.problem-heading').getByRole('button', { name: '重新解答' }).click();
  await expect.poll(() => messages.some(message => message.type === '$$native_action' && message.data.actionId === 'onRegenerate')).toBe(true);
  await expect(page.locator('.teaching-steps .katex')).toHaveCount(2);
  await expect(page.locator('.step-details .answer-figure svg polyline')).toHaveCount(1);
  await expect(page.locator('.original-illustration image')).toHaveAttribute('href', /^data:image\/jpeg;base64,/);
  await expect.poll(() => page.getByAltText('原题对照').evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  await expect.poll(() => messages.some(message => message.type === '$$native_action' && message.data.actionId === 'onReady')).toBe(true);
  const measuredHeight = () => messages.filter(message => message.type === '$$native_action' && message.data.actionId === 'onHeight').at(-1)?.data.args[0] ?? 0;
  await expect.poll(measuredHeight).toBeGreaterThan(300);
  // Feed content height back into the viewport as native Yoga/WebView does.
  const stableHeight = measuredHeight();
  await page.setViewportSize({ width: 360, height: Math.ceil(stableHeight) });
  await page.waitForTimeout(250);
  const heightMessages = () => messages.filter(message => message.type === '$$native_action' && message.data.actionId === 'onHeight').length;
  const settledCount = heightMessages();
  await page.setViewportSize({ width: 360, height: Math.ceil(stableHeight) + 1 });
  await page.waitForTimeout(300);
  assert.equal(heightMessages(), settledCount, 'Viewport height changes must not feed back into document height');
  assert.equal(measuredHeight(), stableHeight);
  const before = measuredHeight();
  await page.getByText('函数求值', { exact: true }).click();
  await expect(page.getByText('代入x=2求平方。')).toBeVisible();
  await expect.poll(measuredHeight).toBeGreaterThan(before);
  await page.getByRole('button', { name: '追问这个知识点' }).click();
  await expect.poll(() => messages.some(message => message.type === '$$native_action' && message.data.actionId === 'onFocus' && message.data.args[0].kind === 'knowledge')).toBe(true);
  await page.setViewportSize({ width: 240, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const formula = page.locator('.teaching-steps .math-block');
  const long = await formula.evaluate(node => node.scrollWidth > node.clientWidth + 1);
  if (long) await expect(page.getByText('左右滑动查看完整公式')).toBeVisible();
  const edges = await formula.evaluate(node => {
    const content = node.querySelector('.katex-html'); const box = node.getBoundingClientRect();
    const start = content.getBoundingClientRect().left; node.scrollLeft = node.scrollWidth;
    return { start, left: box.left, end: content.getBoundingClientRect().right, right: box.right };
  });
  assert.ok(edges.start >= edges.left && edges.end <= edges.right + 1, 'Formula beginning and end remain reachable');
  await page.getByRole('heading', {name:'知识点', exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => 'untrustedExecuted' in globalThis), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'The packaged answer must render offline');
  for (const warning of ['MODEL_TIMEOUT', 'MODEL_OUTPUT_INVALID']) {
    const feedbackPage = await browser.newPage({ viewport: { width: 360, height: 800 } });
    const payload = encodeAnswerDocument({ ...value, outcome: { ...value.outcome, verified: false, verification: null, warning } });
    const props = { ...injected, initialProps: { ...injected.initialProps, props: { payload } } };
    await feedbackPage.addInitScript({ content: `window.ReactNativeWebView = { injectedObjectJson: () => ${JSON.stringify(JSON.stringify(props))}, postMessage: function() {} };` });
    await feedbackPage.goto(pathToFileURL(join(assets, answerFile)).href);
    const feedback = feedbackPage.getByRole('region', { name: '校验说明' });
    await expect(feedback).toContainText(warning === 'MODEL_TIMEOUT' ? '校验超时' : '校验结果无法读取');
    await expect(feedback).not.toContainText('校验发现疑点');
    await expect(feedback).toContainText('重试');
    await feedbackPage.close();
  }
  console.log('PASS: packaged verification timeout/invalid-output explanations distinguish unavailable verdicts from answer issues.');
  console.log('PASS: late bridge startup recovered; early APK answer/history DOM bootstrap, readiness with pending fonts and suspended animation frames, brief multi-question payload, structured choice labels/options, history open bridge, formulas, image, diagram, knowledge, action bridge, dynamic height, 240px document layout, offline resources and injection safety. Not a physical-device test.');
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
