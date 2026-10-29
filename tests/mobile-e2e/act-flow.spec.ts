import { expect, test, type Page } from '@playwright/test';
import { AnswerCandidateSchema, type ProblemStatement } from '../../packages/contracts/src/agent.js';
import { StoredLocalImageSchema, StoredLocalRecordSchema } from '../../packages/contracts/src/local.js';
import { configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';

test.use({ reducedMotion: 'reduce' });
// Synthetic provider fixtures verify UI/context/storage boundaries, not ACT answer accuracy.
// Decision: .agents/notes/implemented/agent/2026-10-20-auxiliary-answer-context.md
const base = { schemaVersion: 1, kind: 'answer', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requestImages(body: unknown): string[] {
  if (!object(body) || !Array.isArray(body.messages)) throw new Error('INVALID_MODEL_REQUEST');
  return body.messages.flatMap((message: unknown) => !object(message) || !Array.isArray(message.content) ? [] : message.content.flatMap((part: unknown) => object(part) && part.type === 'image_url' && object(part.image_url) && typeof part.image_url.url === 'string' ? [part.image_url.url] : []));
}
function expectActRequest(body: unknown) {
  expect(lastModelInput(body)).toMatchObject({ exam: 'act', role: 'solver', verificationMode: 'manual' });
  expect(JSON.stringify(body)).toContain('来源：/skills/exams/references/act.md');
  expect(JSON.stringify(body)).not.toContain('来源：/skills/exams/references/sat.md');
}
function captureFixture(problem: ProblemStatement) {
  return { schemaVersion: 1, kind: 'act-transcript', subject: problem.subject, ...(problem.module ? { module: problem.module } : {}), blocks: [], uncertainties: [],
    questions: [{ number: 1, text: problem.text, ...(problem.sourceNumber ? { sourceNumber: problem.sourceNumber } : {}), ...(problem.options ? { options: problem.options } : {}), ...(problem.optionsComplete === undefined ? {} : { optionsComplete: problem.optionsComplete }), ...(problem.response ? { response: problem.response } : {}), activeSpan: null, uncertainties: problem.uncertainties }] };
}
const actModelPass = { ...modelPass, actTranscription: { body: 'pass', question: 'pass', options: 'pass', activeSpan: 'pass', tables: 'pass' } };
async function configureAct(page: Page) {
  await page.goto('/'); await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'ACT', exact: true }).click(); await configureLocalModel(page);
}
async function photoFile(page: Page, name: string, lines: string[], color = '#ffffff') {
  const image = await page.evaluate(({ lines, color }) => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
    const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS');
    context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#111111'; context.font = '20px sans-serif';
    lines.forEach((line, index) => context.fillText(line, 25, 45 + index * 35));
    return canvas.toDataURL('image/jpeg').split(',')[1]!;
  }, { lines, color });
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(image, 'base64') };
}
async function chooseQuestion(page: Page, lines: string[]) {
  const file = await photoFile(page, 'act-question.jpg', lines); const waiting = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '从相册选择', exact: true }).click(); await (await waiting).setFiles(file);
  await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
}
async function readDocument(page: Page, key: string): Promise<string> {
  return page.evaluate(key => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local', 1); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents'); const read = tx.objectStore('documents').get(key);
      tx.oncomplete = () => { db.close(); if (typeof read.result === 'string') resolve(read.result); else reject(new Error('MISSING_DOCUMENT')); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), key);
}
function sessionId(page: Page) { const id = new URL(page.url()).searchParams.get('session'); if (!id) throw new Error('MISSING_SESSION'); return id; }

test('ACT saves every captured paragraph and original choice punctuation when the answer stage returns a rewritten summary', async ({ page }) => {
  const options = [{ label: 'A', text: 'NO CHANGE' }, { label: 'B', text: 'however;' }, { label: 'C', text: 'however,' }];
  const source = { schemaVersion: 1, kind: 'act-transcript', subject: 'english', blocks: [{ kind: 'passage', text: 'First, the archive were quiet.' }, { kind: 'passage', text: 'The next room, however, was crowded.' }], questions: [{ number: 8, sourceNumber: '8', text: 'Which choice is grammatically acceptable?', options, activeSpan: { block: 1, text: 'however', occurrence: 1 }, uncertainties: [] }], uncertainties: [] };
  const altered = { ...base, problem: { text: 'A summary of the archive and its crowded rooms.', subject: 'english', uncertainties: [], options: [{ label: 'A', text: 'NO CHANGE' }, options[2], options[1]] }, selectedOptions: ['A'], answer: 'The transition fits the context.' };
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const data = lastModelInput(body); calls++;
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(object(data) && data.task === 'act-transcription' ? source : altered, body) });
  });
  await configureAct(page); await chooseQuestion(page, ['First, the archive were quiet.', 'The next room, however, was crowded.', 'Which choice is grammatically acceptable?', ...options.map(option => `${option.label}. ${option.text}`)]);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  const statement = page.getByRole('region', { name: '题目原文', exact: true });
  await expect(statement).toContainText('First, the archive were quiet.'); await expect(statement).toContainText('The next room, however, was crowded.');
  await expect(statement.locator('.choice-label')).toHaveText(['A', 'B', 'C']); await expect(statement.locator('.choice-text')).toHaveText(options.map(option => option.text));
  const raw = await readDocument(page, `record.${sessionId(page)}`); const record = StoredLocalRecordSchema.parse(JSON.parse(raw));
  expect(record.session.runs[0]?.outcome).toMatchObject({ candidate: { problem: { transcriptionScope: 'act-visible', text: 'First, the archive were quiet.\n\nThe next room, **however**, was crowded.\n\nWhich choice is grammatically acceptable?', options } } });
  expect(calls).toBe(2); await page.reload(); await expect(statement).toContainText('First, the archive were quiet.'); expect(calls).toBe(2);
});

const choices = [
  { title: 'English NO CHANGE remains a selectable original option', module: 'English', subject: 'english', text: 'The collection of maps is on the desk. Choose the form of the underlined verb is.', labels: ['A', 'B', 'C', 'D'], texts: ['NO CHANGE', 'are', 'were', 'have been'], selected: 'A', answer: 'The singular subject collection agrees with is.' },
  { title: 'English FGHJ preserves J rather than renumbering it to D', module: 'English', subject: 'english', text: 'The maps are on the desk. Which replacement emphasizes that their present location continues?', labels: ['F', 'G', 'H', 'J'], texts: ['NO CHANGE', 'is', 'was', 'are still'], selected: 'J', answer: 'The synthetic replacement are still keeps plural agreement and marks continuation.' },
  { title: 'legacy Math FGHJK preserves its fifth K option', module: 'Math', subject: 'math', text: 'For x + 1 = 3, which option gives x?', labels: ['F', 'G', 'H', 'J', 'K'], texts: ['-2', '-1', '0', '1', '2'], selected: 'K', answer: 'Subtracting one gives x = 2, the original option K.' },
];
for (const item of choices) test(`ACT ${item.title} (synthetic UI fixture)`, async ({ page }) => {
  const candidate = AnswerCandidateSchema.parse({ ...base, problem: { text: item.text, subject: item.subject, exam: 'act', module: item.module, sourceNumber: '2', response: { type: 'single-choice' }, options: item.labels.map((label, index) => ({ label, text: item.texts[index] })), optionsComplete: true, uncertainties: [] }, selectedOptions: [item.selected], answer: item.answer });
  const bodies: unknown[] = [];
  const captures: unknown[] = [];
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const data = lastModelInput(body); const capture = object(data) && data.task === 'act-transcription';
    (capture ? captures : bodies).push(body);
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(capture ? captureFixture(candidate.problem) : candidate, body) });
  });
  await configureAct(page); await chooseQuestion(page, ['ACT synthetic question 2', item.text, ...item.labels.map((label, index) => `${label}. ${item.texts[index]}`)]);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  const statement = page.getByRole('region', { name: '题目原文', exact: true });
  await expect(statement.locator('.choice-label')).toHaveText(item.labels); await expect(statement.locator('.choice-text')).toHaveText(item.texts);
  await expect(page.locator('.final-answer .answer-choice')).toHaveText(item.selected); await expect(page.locator('.final-answer')).toContainText(item.answer);
  await expect(page.getByText('未校验', { exact: true })).toBeVisible(); await expect(page.getByTestId('current-exam')).toHaveText('本题考试：ACT');
  expect(bodies).toHaveLength(1); expectActRequest(bodies[0]); expect(requestImages(bodies[0])).toHaveLength(1);
  expect(captures).toHaveLength(1); expect(requestImages(captures[0])).toHaveLength(3); expect(requestImages(captures[0]).slice(0, 1)).toEqual(requestImages(bodies[0])); expect(lastModelInput(captures[0])).not.toHaveProperty('candidate');
  const id = sessionId(page); const raw = await readDocument(page, `record.${id}`); const saved = StoredLocalRecordSchema.parse(JSON.parse(raw));
  expect(saved.exam).toBe('act'); expect(saved.session.runs).toHaveLength(1);
  expect(saved.session.runs[0]?.outcome).toMatchObject({ status: 'completed', verified: false, candidate: { problem: { options: candidate.problem.options }, selectedOptions: [item.selected] } });
  await page.reload(); await expect(statement.locator('.choice-label')).toHaveText(item.labels); await expect(statement.locator('.choice-text')).toHaveText(item.texts);
  await expect(page.locator('.final-answer .answer-choice')).toHaveText(item.selected); expect(bodies).toHaveLength(1); expect(await readDocument(page, `record.${id}`)).toBe(raw);
  expect(captures).toHaveLength(1);
});

const essayParagraphs = [
  'A shared place for learning matters. ' + 'A public library lets students compare sources and ask questions without purchasing a private service. '.repeat(12),
  'One perspective favors digital access alone. ' + 'Online collections help distant readers, but a device does not supply a quiet room or a conversation with a librarian. '.repeat(12),
  'Another perspective prioritizes the city budget. ' + 'A balanced plan can measure attendance, retain shared rooms and publish useful digital material for residents. '.repeat(12) + 'The final position therefore combines open physical spaces with accountable digital access.',
];
const essay = essayParagraphs.join('\n\n');
const reviewMessage = 'Review the final paragraph against all three perspectives on the added pages; do not rewrite the essay or predict an ACT score.';
test('ACT Writing follow-up receives the complete essay and ordered additional pages without rewriting earlier evidence or replaying on reload (synthetic UI fixture)', async ({ page }) => {
  const problem = { text: 'Evaluate three perspectives on public libraries: digital-only access, shared physical spaces, and competing budget needs. State and support your own position.', subject: 'english', exam: 'act', module: 'Writing', uncertainties: [] };
  const composition = AnswerCandidateSchema.parse({ ...base, problem: { ...problem, response: { type: 'essay' } }, answer: essay, writing: { mode: 'composition', title: 'Libraries as Shared Public Spaces' } });
  const feedbackText = 'The final paragraph links shared rooms and digital access to the budget objection. Explain what attendance data would show; no official score is predicted.';
  const feedback = AnswerCandidateSchema.parse({ ...base, problem: { ...problem, response: { type: 'short-answer' } }, answer: feedbackText, writing: { mode: 'feedback', title: 'Relation to the three perspectives' } });
  const bodies: unknown[] = [];
  const captures: unknown[] = [];
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    if (object(input) && input.task === 'act-transcription') { captures.push(body); await route.fulfill({ contentType: 'text/event-stream', body: modelSse(captureFixture(composition.problem), body) }); return; }
    bodies.push(body);
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(object(input) && input.message === reviewMessage ? feedback : composition, body) });
  });
  await configureAct(page); await chooseQuestion(page, ['ACT Writing synthetic task', 'Public libraries: evaluate three perspectives.', 'Digital access; shared physical spaces; budget needs.']);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  const article = page.getByRole('article', { name: '作文正文', exact: true }); await expect(article.locator('p')).toHaveText(essayParagraphs);
  expect(essay.length).toBeGreaterThan(2000); expect(bodies).toHaveLength(1); expectActRequest(bodies[0]);
  const id = sessionId(page); const original = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${id}`)));
  const originalImage = await readDocument(page, `image.${id}`); expect(original.session.runs[0]?.imageIds).toEqual([original.session.upload.id]);
  const second = await photoFile(page, 'page-2.jpg', ['ACT Writing page 2', 'Perspective 1: digital-only access.', 'Perspective 2: shared physical spaces.'], '#eef4ff');
  const third = await photoFile(page, 'page-3.jpg', ['ACT Writing page 3', 'Perspective 3: competing budget needs.', 'Address the relationships between perspectives.'], '#fff4ee');
  await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click(); const waiting = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '从相册补图', exact: true }).click(); const chooser = await waiting; expect(chooser.isMultiple()).toBe(true); await chooser.setFiles([third, second]);
  await expect(page.getByTestId('material-import-row')).toHaveCount(2); await expect(page.getByTestId('material-import-row').nth(0)).toContainText('page-2.jpg'); await expect(page.getByTestId('material-import-row').nth(1)).toContainText('page-3.jpg');
  await page.getByRole('button', { name: '保存补图（2张）', exact: true }).click(); await expect(page.getByRole('button', { name: '查看材料 2', exact: true })).toBeVisible(); expect(bodies).toHaveLength(1);
  const withPages = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${id}`))); expect(withPages.session.runs).toEqual(original.session.runs); expect(withPages.materials).toHaveLength(2);
  const materialIds = withPages.materials!.map(material => material.id); expect(withPages.activeImageIds).toEqual([original.session.upload.id, ...materialIds]);
  const expectedImages = [StoredLocalImageSchema.parse(JSON.parse(originalImage)).image, ...await Promise.all(materialIds.map(async materialId => StoredLocalImageSchema.parse(JSON.parse(await readDocument(page, `material.${id}.${materialId}`))).image))];
  expect(requestImages(bodies[0])).toEqual(expectedImages.slice(0, 1)); expect(expectedImages[1]).not.toBe(expectedImages[2]);
  await page.getByRole('button', { name: '返回题目', exact: true }).click(); await page.reload(); await expect(article.locator('p')).toHaveText(essayParagraphs); expect(bodies).toHaveLength(1);
  // Reload drops ordinary Web's in-memory key, but must retain the question and its pages.
  await configureLocalModel(page); await expect(page.getByTestId('current-exam')).toHaveText('本题考试：ACT'); expect(bodies).toHaveLength(1);
  await page.getByLabel('继续问这道题', { exact: true }).fill(reviewMessage); await page.getByRole('button', { name: '发送同题追问', exact: true }).click();
  await expect(page.getByRole('article', { name: '写作点评', exact: true }).locator('p')).toHaveText(feedbackText); expect(bodies).toHaveLength(2); expectActRequest(bodies[1]);
  expect(lastModelInput(bodies[1])).toMatchObject({ message: reviewMessage, materialOrder: materialIds, focus: { kind: 'reply', sourceRunId: original.session.runs[0]?.id, answer: essay, writing: composition.writing, verified: false } });
  expect(requestImages(bodies[1])).toEqual(expectedImages);
  const reviewedRaw = await readDocument(page, `record.${id}`); const reviewed = StoredLocalRecordSchema.parse(JSON.parse(reviewedRaw));
  expect(reviewed.exam).toBe('act'); expect(reviewed.session.runs).toHaveLength(2); expect(reviewed.session.runs[0]).toEqual(original.session.runs[0]); expect(reviewed.session.runs[1]?.imageIds).toEqual(withPages.activeImageIds);
  expect(await readDocument(page, `image.${id}`)).toBe(originalImage);
  await page.reload(); await expect(page.getByRole('article', { name: '写作点评', exact: true }).locator('p')).toHaveText(feedbackText);
  await expect(page.getByTestId('current-exam')).toHaveText('本题考试：ACT'); expect(bodies).toHaveLength(2); expect(await readDocument(page, `record.${id}`)).toBe(reviewedRaw);
  expect(captures).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('ACT verification of historical R1 keeps its original candidate, context and photo after an R2 correction (synthetic UI fixture)', async ({ page }) => {
  const correction = 'R2_CORRECTION_ONLY: the equation is x + 1 = 5, not x + 1 = 3.';
  const r1 = AnswerCandidateSchema.parse({ ...base, problem: { text: 'Solve x + 1 = 3.', subject: 'math', exam: 'act', module: 'Math', uncertainties: [] }, answer: 'R1 original answer: x = 2.' });
  const r2 = AnswerCandidateSchema.parse({ ...base, problem: { ...r1.problem, text: 'Solve x + 1 = 5.' }, answer: 'R2 corrected answer: x = 4.' });
  const bodies: unknown[] = [];
  const captures: unknown[] = [];
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    if (object(input) && input.task === 'act-transcription') { captures.push(body); await route.fulfill({ contentType: 'text/event-stream', body: modelSse(captureFixture(input.problemCorrection === correction ? r2.problem : r1.problem), body) }); return; }
    bodies.push(body);
    const result = object(input) && input.role === 'verifier' ? actModelPass : object(input) && input.problemCorrection === correction ? r2 : r1;
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(result, body) });
  });
  await configureAct(page); await chooseQuestion(page, ['ACT Math synthetic R1', 'Solve x + 1 = 3.']);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  const thread = page.getByRole('region', { name: '这道题的持续对话', exact: true });
  await expect(thread.locator('.final-answer')).toContainText(r1.answer); expect(bodies).toHaveLength(1); expectActRequest(bodies[0]);
  const id = sessionId(page); const original = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${id}`)));
  const originalImageRaw = await readDocument(page, `image.${id}`); const originalImage = StoredLocalImageSchema.parse(JSON.parse(originalImageRaw)).image;
  const replacement = await photoFile(page, 'act-r2-correction.jpg', ['ACT Math synthetic R2', 'Solve x + 1 = 5.'], '#fff0d5');
  await thread.getByRole('button', { name: '识别有误？更正题干', exact: true }).click();
  await expect(page.getByTestId('correction-image')).toHaveCount(1); const waiting = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '添加图片', exact: true }).click(); await (await waiting).setFiles(replacement);
  await page.getByRole('button', { name: '使用这张题图', exact: true }).click(); await expect(page.getByTestId('correction-image')).toHaveCount(2);
  await page.getByRole('button', { name: '删除图片1', exact: true }).click(); await expect(page.getByTestId('correction-image')).toHaveCount(1);
  await page.getByLabel('更正后的题干', { exact: true }).fill(correction); expect(bodies).toHaveLength(1);
  await page.getByRole('button', { name: '按更正重新解答', exact: true }).click(); await expect(thread.locator('.final-answer')).toContainText(r2.answer);
  expect(bodies).toHaveLength(2); expectActRequest(bodies[1]); expect(lastModelInput(bodies[1])).toMatchObject({ problemCorrection: correction });
  const corrected = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${id}`)));
  expect(corrected.session.runs).toHaveLength(2); expect(corrected.session.runs[0]).toEqual(original.session.runs[0]);
  expect(corrected.session.runs[1]?.context).toMatchObject({ kind: 'correction', text: correction });
  expect(corrected.activeImageIds).toHaveLength(1); const replacementId = corrected.activeImageIds?.[0]; if (!replacementId) throw new Error('MISSING_REPLACEMENT');
  expect(replacementId).not.toBe(original.session.upload.id);
  const replacementRaw = await readDocument(page, `material.${id}.${replacementId}`); const replacementImage = StoredLocalImageSchema.parse(JSON.parse(replacementRaw)).image;
  expect(replacementImage).not.toBe(originalImage); expect(requestImages(bodies[1])).toEqual([replacementImage]);
  const savedAnswerBytes = corrected.session.runs.map(run => JSON.stringify(run));
  await thread.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第1次解答', exact: true }).click();
  await expect(thread.locator('.final-answer')).toContainText(r1.answer); await expect(thread.getByText('这是题干更正前的解答，请结合最新更正后的条件判断。', { exact: true })).toBeVisible();
  await expect(thread.locator('.original-photo-preview img')).toHaveAttribute('src', originalImage);
  await thread.getByRole('button', { name: '校验', exact: true }).click(); await expect(thread.getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
  expect(bodies).toHaveLength(3); const input = lastModelInput(bodies[2]);
  if (!object(input)) throw new Error('INVALID_VERIFICATION_INPUT');
  expect(input).toMatchObject({ exam: 'act', role: 'verifier', candidate: r1 });
  expect(input).not.toHaveProperty('problemCorrection'); expect(input).not.toHaveProperty('materialOrder');
  expect(JSON.stringify(input.history)).toContain(r1.answer); expect(JSON.stringify(input.history)).not.toContain(correction); expect(JSON.stringify(input.history)).not.toContain(r2.answer);
  expect(requestImages(bodies[2])).toHaveLength(3); expect(requestImages(bodies[2]).slice(0, 1)).toEqual([originalImage]); expect(JSON.stringify(bodies[2])).toContain('来源：/skills/exams/references/act.md');
  const checkedRaw = await readDocument(page, `record.${id}`); const checked = StoredLocalRecordSchema.parse(JSON.parse(checkedRaw));
  expect(checked.session.runs).toHaveLength(3); expect(checked.session.runs.slice(0, 2).map(run => JSON.stringify(run))).toEqual(savedAnswerBytes);
  expect(checked.session.runs[2]?.context).toMatchObject({ kind: 'verification', sourceRunId: original.session.runs[0]?.id });
  expect(checked.activeImageIds).toEqual(corrected.activeImageIds); expect(await readDocument(page, `image.${id}`)).toBe(originalImageRaw); expect(await readDocument(page, `material.${id}.${replacementId}`)).toBe(replacementRaw);
  await thread.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第2次解答', exact: true }).click();
  await expect(thread.locator('.final-answer')).toContainText(r2.answer); await expect(thread.getByText('未校验', { exact: true })).toBeVisible(); await expect(thread.locator('.original-photo-preview img')).toHaveAttribute('src', replacementImage);
  await page.reload(); await expect(thread.locator('.final-answer')).toContainText(r2.answer); await expect(page.getByTestId('current-exam')).toHaveText('本题考试：ACT');
  expect(bodies).toHaveLength(3); expect(await readDocument(page, `record.${id}`)).toBe(checkedRaw);
  expect(captures).toHaveLength(2); expect(requestImages(captures[0]).slice(0, 1)).toEqual([originalImage]); expect(requestImages(captures[1]).slice(0, 1)).toEqual([replacementImage]);
});
