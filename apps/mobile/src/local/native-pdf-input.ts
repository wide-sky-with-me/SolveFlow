import { NativePdfInputSchema, type NativePdfInput } from '@solveflow/contracts/local';
import { projectBatchPrintSnapshot, batchPrintFilename, batchQuestionFilename, batchPrintArchiveFilename } from '@solveflow/client/presentation';
import { directBatchBlocks } from './direct-batch-content';
import { recordPrintImages, printImageKey } from './batch-print-images';
import { requireExportQuestions } from './export-preflight';
import type { PreparedExportContent } from './prepare-batch-export.web';

/** Same content projection and copy plans as Web; source ownership includes current supplements. */
export function nativePdfItems(value: unknown) {
  const input = NativePdfInputSchema.parse(value);
  const { snapshot, problems, questions } = projectBatchPrintSnapshot(input.snapshot, input.mode === 'answers');
  requireExportQuestions(problems, input.mode, 'direct');
  const prepared: PreparedExportContent = { layouts: {}, images: {} };
  for (const question of problems) {
    const record = snapshot.records.find(record => record.session.id === question.recordId);
    if (!record || !question.problem) throw new Error(`第${question.ordinal}题缺少已保存内容。`);
    const sources = recordPrintImages(record);
    prepared.layouts[question.key] = { problem: question.problem, warnings: [], assets: sources.map(source => ({ key: printImageKey(record.session.id, source.id), sourceId: source.id, alt: '保存的原题图', role: 'source' })) };
    for (const source of sources) prepared.images[printImageKey(record.session.id, source.id)] = source.image;
  }
  for (const copy of input.copies) {
    if (copy.total !== problems.length || copy.answers.some((answer, index) => answer.key !== problems[index]?.key || answer.recordId !== problems[index]?.recordId)) throw new Error('副本作答与本批题目不一致，请重新设置。');
    for (const answer of copy.answers) if (answer.changed && answer.selectedOptions?.some(label => !prepared.layouts[answer.key]?.problem.options?.some(option => option.label === label))) throw new Error(`第${answer.ordinal}题作答选项不完整。`);
  }
  const marking = { markIncorrect: input.markIncorrect };
  const items = input.mode === 'questions'
    ? [{ name: batchQuestionFilename(snapshot.batch.title, problems.length), blocks: directBatchBlocks({ mode: 'questions', title: snapshot.batch.title, problems, prepared }) }]
    : input.copies.map(copy => ({ name: batchPrintFilename(snapshot.batch.title, copy, { ...marking, exportedAt: input.exportedAt }), blocks: directBatchBlocks({ mode: 'answers', title: snapshot.batch.title, problems, questions, prepared, copy, ...marking }) }));
  return { input, count: problems.length, items, archiveName: batchPrintArchiveFilename(snapshot.batch.title, items.length, marking) };
}

export function nativePdfMetadata(input: NativePdfInput, questionCount: number) {
  return { batchId: input.snapshot.batch.id, title: input.snapshot.batch.title, mode: input.mode, markIncorrect: input.markIncorrect, layout: 'direct' as const, copies: input.mode === 'answers' ? input.copies.length : 1, questionCount };
}
