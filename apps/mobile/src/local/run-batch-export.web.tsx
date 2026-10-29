// Decision: .agents/notes/implemented/storage/2026-10-14-background-pdf-exports.md
// Decision: .agents/notes/implemented/storage/2026-10-21-marked-answer-exports.md
import { createBatchExportRoot } from './batch-export-root.web';
import { BatchPrintCopySchema, type BatchPrintSnapshot, type BatchPrintCopy } from '@solveflow/contracts/local';
import { batchQuestionFilename, batchPrintFilename, batchPrintArchiveFilename, projectBatchPrintSnapshot, projectCapturedBatchPrintSnapshot } from '@solveflow/client/presentation';
import type { ExportArtifact } from '@solveflow/client/local';
import type { Runtime } from '../runtime';
import { BatchCopyDocument } from '../dom/batch-copy-document';
import { BatchPrintDocument, recordPrintImages, printImageKey } from '../dom/batch-print-document';
import { requireCleanPrintLayouts, requireSavedPrintLayouts, requirePaperPrintLayouts, requirePrintableCopies, type BatchPdfContent } from './batch-print-presentation.web';
import { prepareBatchExport, type ExportLayout, type PreparedExportContent } from './prepare-batch-export.web';
import { buildBatchPdfs, formatBatchPdfProgress, requireBatchPdfPageCount } from './download-batch-pdfs.web';
import { directBatchBlocks } from './direct-batch-content';
import { buildDirectBatchPdfs } from './direct-batch-pdf.web';
import '../dom/answer.css';
import '../../.generated/katex.css';
import '../dom/batch-print.css';

export interface BatchExportInput {
  snapshot: BatchPrintSnapshot;
  exportedAt?: string;
  mode: BatchPdfContent;
  markIncorrect?: boolean;
  layout: ExportLayout;
  copies: BatchPrintCopy[];
  prepared: PreparedExportContent;
}
/** Generic callers keep a complete synchronous source capture before any task boundary. */
export async function runBatchExport(runtime: Runtime, input: BatchExportInput, signal: AbortSignal, progress: (value: string) => void): Promise<ExportArtifact> {
  signal.throwIfAborted();
  const projected = projectBatchPrintSnapshot(
    input.snapshot, input.mode === 'answers', input.mode === 'reading' || input.layout === 'direct' ? undefined : requireBatchPdfPageCount,
  );
  return renderBatchExport(runtime, input, signal, progress, projected);
}

// Decision: .agents/notes/implemented/storage/2026-10-19-pdf-captured-projection.md
/** The queue retains exclusive ownership of its native capture across every validation turn. */
export async function runCapturedBatchExport(runtime: Runtime, input: BatchExportInput, signal: AbortSignal, progress: (value: string) => void, checkpoint: () => Promise<void>): Promise<ExportArtifact> {
  signal.throwIfAborted();
  let projected: ReturnType<typeof projectBatchPrintSnapshot>;
  try {
    progress('正在核对导出内容');
    projected = await projectCapturedBatchPrintSnapshot(
      input.snapshot, input.mode === 'answers', async () => { signal.throwIfAborted(); await checkpoint(); signal.throwIfAborted(); }, input.mode === 'reading' || input.layout === 'direct' ? undefined : requireBatchPdfPageCount,
    );
    signal.throwIfAborted();
    progress('正在准备导出页面');
  } finally { signal.throwIfAborted(); }
  return renderBatchExport(runtime, input, signal, progress, projected);
}

/** The renderer belongs to the job, not to the dialog or the current workspace page. */
async function renderBatchExport(runtime: Runtime, input: BatchExportInput, signal: AbortSignal, progress: (value: string) => void, { snapshot, problems, questions }: ReturnType<typeof projectBatchPrintSnapshot>): Promise<ExportArtifact> {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const copies = input.mode === 'answers' ? input.copies.map(copy => BatchPrintCopySchema.parse(copy)) : [];
  if (input.mode === 'answers' && !copies.length) throw new Error('作答副本尚未配置。');
  const content = input.mode === 'reading' ? { layouts: {}, images: Object.fromEntries(snapshot.records.flatMap(record => recordPrintImages(record, 'history').map(source => [printImageKey(record.session.id, source.id), source.image]))) } : await prepareBatchExport(runtime, snapshot, problems, input.layout, signal, progress, input.prepared);
  if (input.mode !== 'reading') (input.layout === 'clean' ? requireCleanPrintLayouts : input.layout === 'paper' ? requirePaperPrintLayouts : requireSavedPrintLayouts)(problems, content.layouts, content.images);
  requirePrintableCopies(copies, content.layouts);
  signal.throwIfAborted();
  if (input.mode !== 'reading' && input.layout === 'direct') {
    const marking = input.markIncorrect === true ? { markIncorrect: true } : {};
    const items = input.mode === 'questions'
      ? [{ name: batchQuestionFilename(snapshot.batch.title, problems.length), blocks: directBatchBlocks({ mode: 'questions', title: snapshot.batch.title, problems, prepared: content }) }]
      : copies.map(copy => ({ name: batchPrintFilename(snapshot.batch.title, copy, { ...marking, exportedAt }), blocks: directBatchBlocks({ mode: 'answers', title: snapshot.batch.title, problems, prepared: content, questions, copy, ...marking }) }));
    return buildDirectBatchPdfs(items, batchPrintArchiveFilename(snapshot.batch.title, items.length, marking), signal, value => progress(formatBatchPdfProgress(value)), progress);
  }
  const root = createBatchExportRoot(signal);
  try {
    const marking = input.mode === 'answers' && input.markIncorrect === true ? { markIncorrect: true } : {};
    const items = input.mode === 'reading' ? [{ name: `${snapshot.batch.title}_原始记录.pdf`, element: () => root.render(<BatchPrintDocument snapshot={snapshot} images={content.images} />) }] : input.mode === 'questions' ? [{ name: batchQuestionFilename(snapshot.batch.title, problems.length), element: () => root.render(<BatchCopyDocument mode="questions" snapshot={snapshot} problems={problems} layouts={content.layouts} images={content.images} />) }] : copies.map(copy => ({ name: batchPrintFilename(snapshot.batch.title, copy, { ...marking, exportedAt }), element: () => root.render(<BatchCopyDocument snapshot={snapshot} problems={problems} questions={questions} copy={copy} layouts={content.layouts} images={content.images} {...marking} />) }));
    return await buildBatchPdfs(items, batchPrintArchiveFilename(snapshot.batch.title, items.length, marking), root.signal, value => progress(formatBatchPdfProgress(value)));
  } catch (error) { signal.throwIfAborted(); root.signal.throwIfAborted(); throw error; }
  finally { try { root.dispose(); } finally { signal.throwIfAborted(); } }
}
