import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript';

function fixture(capturedOnly = false) {
  const pageError = new Error('PAGE_GATE');
  const projectionError = new Error('PROJECTION_STOP');
  const gate = vi.fn((_count: number) => { throw pageError; });
  const project = vi.fn((_input: unknown, _answers: boolean, check?: (count: number) => void) => {
    check?.(301);
    throw projectionError;
  });
  const turn = vi.fn(async (signal: AbortSignal) => { signal.throwIfAborted(); });
  const capturedProject = vi.fn(async (_input: unknown, _answers: boolean, beforeRecord: () => Promise<void>, check?: (count: number) => void) => {
    await beforeRecord();
    check?.(301);
    throw projectionError;
  });
  const modules: Record<string, unknown> = {
    '@solveflow/client/presentation': { projectBatchPrintSnapshot: project, projectCapturedBatchPrintSnapshot: capturedProject },
    './download-batch-pdfs.web': { requireBatchPdfPageCount: gate },
    './export-admission.web': { yieldExportAdmission: turn },
  };
  const source = readFileSync(new URL('./run-batch-export.web.tsx', import.meta.url), 'utf8');
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', compiled)((name: string) => modules[name] ?? {}, exports);
  const run = exports[capturedOnly ? 'runCapturedBatchExport' : 'runBatchExport'];
  if (typeof run !== 'function') throw new Error('Renderer fixture missing entrypoint');
  return { run: (runtime: unknown, input: unknown, signal: AbortSignal, progress: (value: string) => void) => capturedOnly ? run(runtime, input, signal, progress, () => turn(signal)) : run(runtime, input, signal, progress), project, capturedProject, turn, gate, pageError, projectionError };
}

it('honors an existing cancellation before validating or projecting source data', async () => {
  const { run, project, gate } = fixture();
  const controller = new AbortController();
  const cancelled = new Error('CANCELLED');
  controller.abort(cancelled);
  await expect(run({}, { snapshot: 'SOURCE', mode: 'answers' }, controller.signal, vi.fn())).rejects.toBe(cancelled);
  expect(project).not.toHaveBeenCalled();
  expect(gate).not.toHaveBeenCalled();
});

it.each(['answers', 'questions', 'reading'])('routes %s through one validated projection with the existing page gate', async mode => {
  const { run, project, gate, pageError, projectionError } = fixture();
  const reading = mode === 'reading';
  await expect(run({}, { snapshot: 'SOURCE', mode }, new AbortController().signal, vi.fn())).rejects.toBe(reading ? projectionError : pageError);
  expect(project).toHaveBeenCalledExactlyOnceWith('SOURCE', mode === 'answers', reading ? undefined : gate);
  expect(gate).toHaveBeenCalledTimes(reading ? 0 : 1);
});

function renderedFixture(stop?: 'failure' | 'cancel', cleanupError = false, capturedOnly = false) {
  const user = new AbortController(); const child = new AbortController(); const rootFailure = new Error('ROOT_FAILURE'); const userReason = new Error('USER_CANCELLED');
  const snapshot = { batch: { title: 'batch' }, records: [{ session: { id: 'source' } }] };
  const problems = [{ key: 'one' }, { key: 'two' }]; const questions = [{ key: 'one', answer: 'A' }, { key: 'two', answer: 'B' }];
  const copies = [{ copyIndex: 1, answers: ['A'] }, { copyIndex: 2, answers: ['B'] }];
  const content = { layouts: {}, images: {} }; const artifact = { name: 'batch.zip', mimeType: 'application/zip', data: new Uint8Array([7]) };
  const render = vi.fn(async (node: unknown) => ({ main: node })); const dispose = vi.fn(() => { if (cleanupError) throw new Error('UNTRUSTED_CLEANUP'); });
  const mount = vi.fn(() => ({ signal: child.signal, render, dispose }));
  const build = vi.fn(async (items: ReadonlyArray<{ element: () => Promise<unknown> }>, _name: string, signal: AbortSignal) => {
    expect(signal).toBe(child.signal);
    for (const item of items) {
      await item.element();
      if (stop) { child.abort(rootFailure); if (stop === 'cancel') user.abort(userReason); throw new Error('DOWNSTREAM_CANCELLED'); }
    }
    return artifact;
  });
  const historyImages = vi.fn(() => [{ id: 'historic', image: 'HISTORY_IMAGE' }]);
  const project = vi.fn(() => ({ snapshot, problems, questions }));
  const projectionComplete = vi.fn();
  const capturedProject = vi.fn(async (_input: unknown, _answers: boolean, beforeRecord: () => Promise<void>) => {
    await beforeRecord(); await beforeRecord(); projectionComplete(); return { snapshot, problems, questions };
  });
  const turn = vi.fn(async (signal: AbortSignal) => { signal.throwIfAborted(); }); const progress = vi.fn();
  const prepare = vi.fn(async () => content);
  const parseCopy = vi.fn((value: unknown) => value);
  const dependencies: Record<string, unknown> = {
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }) },
    '@solveflow/contracts/local': { BatchPrintCopySchema: { parse: parseCopy } },
    '@solveflow/client/presentation': { projectBatchPrintSnapshot: project, projectCapturedBatchPrintSnapshot: capturedProject, batchQuestionFilename: () => 'questions.pdf', batchPrintFilename: (_title: string, copy: { copyIndex: number }) => `copy-${copy.copyIndex}.pdf`, batchPrintArchiveFilename: () => 'batch.zip' },
    './export-admission.web': { yieldExportAdmission: turn },
    '../dom/batch-copy-document': { BatchCopyDocument: 'COPY' },
    '../dom/batch-print-document': { BatchPrintDocument: 'READING', recordPrintImages: historyImages, printImageKey: () => 'historic' },
    './batch-export-root.web': { createBatchExportRoot: mount },
    './prepare-batch-export.web': { prepareBatchExport: prepare },
    './batch-print-presentation.web': { requireCleanPrintLayouts: () => {}, requireSavedPrintLayouts: () => {}, requirePaperPrintLayouts: () => {}, requirePrintableCopies: () => {} },
    './download-batch-pdfs.web': { buildBatchPdfs: build, formatBatchPdfProgress: () => '', requireBatchPdfPageCount: () => {} },
  };
  const text = readFileSync(new URL('./run-batch-export.web.tsx', import.meta.url), 'utf8');
  const compiled = transpileModule(text, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX } }).outputText;
  const exported: Record<string, unknown> = {}; new Function('require', 'exports', compiled)((name: string) => dependencies[name] ?? {}, exported);
  const run = exported[capturedOnly ? 'runCapturedBatchExport' : 'runBatchExport']; if (typeof run !== 'function') throw new Error('RUNNER_MISSING');
  return { run: (mode = 'answers') => run({}, { snapshot: 'SOURCE', mode, copies, layout: 'saved', prepared: {} }, user.signal, progress, ...(capturedOnly ? [() => turn(user.signal)] : [])), user, child, rootFailure, userReason, render, dispose, mount, build, snapshot, problems, questions, copies, artifact, historyImages, project, capturedProject, projectionComplete, prepare, turn, progress, parseCopy };
}

it.each(['answers', 'questions', 'reading'])('renders %s through the owned asynchronous root and disposes it', async mode => {
  const f = renderedFixture(); await expect(f.run(mode)).resolves.toBe(f.artifact); expect(f.mount).toHaveBeenCalledExactlyOnceWith(f.user.signal);
  expect(f.render).toHaveBeenCalledTimes(mode === 'answers' ? 2 : 1); expect(f.dispose).toHaveBeenCalledTimes(1);
  if (mode === 'answers') for (const copy of f.copies) expect(f.render).toHaveBeenCalledWith({ type: 'COPY', props: { snapshot: f.snapshot, problems: f.problems, questions: f.questions, copy, layouts: {}, images: {} } });
  else if (mode === 'questions') expect(f.render).toHaveBeenCalledWith({ type: 'COPY', props: { mode: 'questions', snapshot: f.snapshot, problems: f.problems, layouts: {}, images: {} } });
  else { expect(f.historyImages).toHaveBeenCalledWith(f.snapshot.records[0], 'history'); expect(f.render).toHaveBeenCalledWith({ type: 'READING', props: { snapshot: f.snapshot, images: { historic: 'HISTORY_IMAGE' } } }); }
});
it.each(['failure', 'cancel'] as const)('preserves %s precedence after a child root stops the downloader', async stop => {
  const f = renderedFixture(stop); await expect(f.run()).rejects.toBe(stop === 'cancel' ? f.userReason : f.rootFailure);
  expect(f.user.signal.aborted).toBe(stop === 'cancel'); expect(f.dispose).toHaveBeenCalledTimes(1); expect(f.render).toHaveBeenCalledTimes(1);
});
it('preserves the owner cancellation even if root disposal throws', async () => {
  const f = renderedFixture('cancel', true); await expect(f.run()).rejects.toBe(f.userReason); expect(f.dispose).toHaveBeenCalledTimes(1);
});

it.each(['answers', 'questions', 'reading'])('validates owned %s through the cooperative projector and original page gate', async mode => {
  const f = fixture(true); const progress = vi.fn(); const reading = mode === 'reading';
  await expect(f.run({}, { snapshot: 'SOURCE', mode }, new AbortController().signal, progress)).rejects.toBe(reading ? f.projectionError : f.pageError);
  expect(f.project).not.toHaveBeenCalled(); expect(f.capturedProject).toHaveBeenCalledExactlyOnceWith('SOURCE', mode === 'answers', expect.any(Function), reading ? undefined : f.gate);
  expect(f.turn).toHaveBeenCalledTimes(1); expect(f.gate).toHaveBeenCalledTimes(reading ? 0 : 1); expect(progress).toHaveBeenCalledExactlyOnceWith('正在核对导出内容');
});
it('stops a pre-cancelled captured job before progress, validation or scheduling', async () => {
  const f = fixture(true); const controller = new AbortController(); const reason = new Error('PRE_CANCELLED'); const progress = vi.fn(); controller.abort(reason);
  await expect(f.run({}, { snapshot: 'SOURCE', mode: 'answers' }, controller.signal, progress)).rejects.toBe(reason);
  expect(f.project).not.toHaveBeenCalled(); expect(f.capturedProject).not.toHaveBeenCalled(); expect(f.turn).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
});
it.each([false, true])('preserves projection rejection unless owner cancellation wins: %s', async cancel => {
  const f = fixture(true); const controller = new AbortController(); const reason = new Error('CANCELLED'); const failure = new Error('PROJECTION_FAILURE');
  let release = () => {}; const pendingProjection = new Promise<void>(resolve => { release = resolve; });
  f.capturedProject.mockImplementation(async () => { await pendingProjection; throw failure; });
  const progress = vi.fn(); const outcome = f.run({}, { snapshot: 'SOURCE', mode: 'answers' }, controller.signal, progress).catch((error: unknown) => error);
  if (cancel) controller.abort(reason); release(); expect(await outcome).toBe(cancel ? reason : failure); expect(f.gate).not.toHaveBeenCalled();
  expect(progress).toHaveBeenCalledExactlyOnceWith('正在核对导出内容');
});
it.each(['answers', 'questions', 'reading'])('renders captured %s through the same owned root and disposes it', async mode => {
  const f = renderedFixture(undefined, false, true);
  f.turn.mockImplementation(async signal => { signal.throwIfAborted(); expect(f.progress.mock.calls).toEqual([['正在核对导出内容']]); });
  await expect(f.run(mode)).resolves.toBe(f.artifact);
  expect(f.project).not.toHaveBeenCalled(); expect(f.capturedProject).toHaveBeenCalledTimes(1); expect(f.turn).toHaveBeenCalledTimes(2);
  expect(f.progress.mock.calls).toEqual([['正在核对导出内容'], ['正在准备导出页面']]);
  expect(f.progress.mock.invocationCallOrder[0]).toBeLessThan(f.capturedProject.mock.invocationCallOrder[0]!);
  expect(f.projectionComplete.mock.invocationCallOrder[0]).toBeLessThan(f.progress.mock.invocationCallOrder[1]!);
  expect(f.progress.mock.invocationCallOrder[1]).toBeLessThan((mode === 'reading' ? f.historyImages : f.prepare).mock.invocationCallOrder[0]!);
  expect(f.mount).toHaveBeenCalledExactlyOnceWith(f.user.signal);
  expect(f.render).toHaveBeenCalledTimes(mode === 'answers' ? 2 : 1); expect(f.dispose).toHaveBeenCalledTimes(1);
});
it.each(['answers', 'questions', 'reading'].flatMap(mode => ['abort', 'throw', 'throw+abort'].map(action => ({ mode, action }))))('settles the second captured progress callback before $mode rendering ($action)', async ({ mode, action }) => {
  const f = renderedFixture(undefined, false, true); const failure = new Error('PREPARATION_PROGRESS_FAILED');
  f.progress.mockImplementation((value: string) => {
    if (value !== '正在准备导出页面') return;
    expect(f.projectionComplete).toHaveBeenCalledTimes(1);
    if (action !== 'throw') f.user.abort(f.userReason);
    if (action !== 'abort') throw failure;
  });
  await expect(f.run(mode)).rejects.toBe(action === 'throw' ? failure : f.userReason);
  expect(f.progress.mock.calls).toEqual([['正在核对导出内容'], ['正在准备导出页面']]);
  expect(f.capturedProject).toHaveBeenCalledTimes(1); expect(f.turn).toHaveBeenCalledTimes(2); expect(f.projectionComplete).toHaveBeenCalledTimes(1);
  expect(f.parseCopy).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.historyImages).not.toHaveBeenCalled();
  expect(f.mount).not.toHaveBeenCalled(); expect(f.render).not.toHaveBeenCalled(); expect(f.build).not.toHaveBeenCalled(); expect(f.dispose).not.toHaveBeenCalled();
});
it.each(['failure', 'cancel'] as const)('preserves captured child-root %s priority after projection', async stop => {
  const f = renderedFixture(stop, false, true); await expect(f.run()).rejects.toBe(stop === 'cancel' ? f.userReason : f.rootFailure); expect(f.dispose).toHaveBeenCalledTimes(1);
});
it('settles cancellation after the final validation result before copies or root side effects', async () => {
  const f = renderedFixture(undefined, false, true);
  f.capturedProject.mockImplementation(async () => { f.user.abort(f.userReason); return { snapshot: f.snapshot, problems: f.problems, questions: f.questions }; });
  await expect(f.run()).rejects.toBe(f.userReason); expect(f.parseCopy).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.mount).not.toHaveBeenCalled(); expect(f.build).not.toHaveBeenCalled();
  expect(f.progress).toHaveBeenCalledExactlyOnceWith('正在核对导出内容');
});
it('closes captured cancellation even when root disposal throws', async () => {
  const f = renderedFixture('cancel', true, true); await expect(f.run()).rejects.toBe(f.userReason); expect(f.dispose).toHaveBeenCalledTimes(1);
});
it('keeps the generic renderer free of newly introduced projection scheduling', async () => {
  const f = renderedFixture(); await expect(f.run()).resolves.toBe(f.artifact); expect(f.capturedProject).not.toHaveBeenCalled(); expect(f.turn).not.toHaveBeenCalled(); expect(f.progress).not.toHaveBeenCalled();
});
