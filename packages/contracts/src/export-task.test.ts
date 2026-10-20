import { describe, expect, it } from 'vitest';
import {
  ExportTaskFileSchema, ExportTaskMetadataSchema, ExportTaskSchema, isExportTaskTerminal,
  MAX_EXPORT_ARTIFACT_BYTES, MAX_EXPORT_ERROR_CHARACTERS, MAX_EXPORT_PROGRESS_CHARACTERS,
  type ExportTask,
} from './export-task.js';

const id = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const createdAt = '2026-10-14T00:00:00.000Z';
const startedAt = '2026-10-14T00:01:00.000Z';
const finishedAt = '2026-10-14T00:02:00.000Z';
const queued: ExportTask = { schemaVersion: 1, id, batchId, title: 'Export', mode: 'answers', layout: 'saved', copies: 1, questionCount: 2, parentId: null, createdAt, startedAt: null, finishedAt: null, status: 'queued', progress: '', error: null, file: null };
const file = { name: 'export.pdf', mimeType: 'application/pdf' as const, bytes: 3 };

describe('export task contract', () => {
  it.each([
    queued,
    { ...queued, status: 'running', startedAt },
    { ...queued, status: 'running', startedAt, error: 'Waiting for storage' },
    { ...queued, status: 'succeeded', startedAt, finishedAt, file },
    { ...queued, status: 'failed', finishedAt, error: 'Start failed' },
    { ...queued, status: 'failed', startedAt, finishedAt, error: 'Failed' },
    { ...queued, status: 'cancelled', finishedAt },
    { ...queued, status: 'interrupted', finishedAt, error: 'Interrupted' },
  ])('accepts a coherent $status record', task => {
    const parsed = ExportTaskSchema.parse(task);
    expect(parsed).toEqual(task);
    expect(isExportTaskTerminal(parsed.status)).toBe(task.finishedAt !== null);
  });

  it.each([
    { schemaVersion: 2 }, { id: 'not-uuid' }, { batchId: 'not-uuid' }, { parentId: id },
    { startedAt, status: 'queued' }, { status: 'queued', error: 'Failure' },
    { status: 'running' }, { status: 'running', startedAt, finishedAt },
    { status: 'succeeded', startedAt, finishedAt },
    { status: 'succeeded', startedAt, finishedAt, file, error: 'Failure' },
    { status: 'cancelled' }, { status: 'cancelled', finishedAt, file },
    { status: 'cancelled', finishedAt, error: 'Failure' },
    { status: 'failed', finishedAt }, { status: 'interrupted', finishedAt },
    { status: 'running', startedAt: '2026-10-13T23:59:59.000Z' },
    { status: 'failed', startedAt, finishedAt: createdAt, error: 'Failure' },
    { status: 'failed', finishedAt: '2026-10-13T23:59:59.000Z', error: 'Failure' },
    { copies: 0 }, { copies: 21 }, { copies: 1.5 }, { questionCount: 0 }, { questionCount: 401 },
    { progress: 'x'.repeat(MAX_EXPORT_PROGRESS_CHARACTERS + 1) },
    { status: 'failed', finishedAt, error: 'x'.repeat(MAX_EXPORT_ERROR_CHARACTERS + 1) },
    { question: 'private source' }, { modelKey: 'private key' }, { file },
  ])('rejects inconsistent or unbounded metadata %j', patch => {
    expect(ExportTaskSchema.safeParse({ ...queued, ...patch }).success).toBe(false);
  });

  it('uses strict metadata, normalizes titles, and defaults only the enqueue parent', () => {
    const metadata = { batchId, title: ' Export ', mode: 'questions', layout: 'clean', copies: 20, questionCount: 400 };
    expect(ExportTaskMetadataSchema.parse(metadata)).toEqual({ ...metadata, title: 'Export', parentId: null });
    expect(ExportTaskMetadataSchema.safeParse({ ...metadata, id }).success).toBe(false);
    const { parentId: _parent, ...missingParent } = queued;
    expect(ExportTaskSchema.safeParse(missingParent).success).toBe(false);
  });

  it.each(['../export.pdf', 'a/b.pdf', 'a\\b.pdf', '.', '..', '', 'a\n.pdf', 'a\u0000.pdf'])('rejects unsafe file name %j', name => {
    expect(ExportTaskFileSchema.safeParse({ ...file, name }).success).toBe(false);
  });
  it('bounds stored files and accepts ZIP without artifact content in metadata', () => {
    expect(ExportTaskFileSchema.parse({ ...file, name: 'exports.zip', mimeType: 'application/zip', bytes: MAX_EXPORT_ARTIFACT_BYTES })).toMatchObject({ bytes: MAX_EXPORT_ARTIFACT_BYTES });
    for (const patch of [{ bytes: 0 }, { bytes: MAX_EXPORT_ARTIFACT_BYTES + 1 }, { mimeType: 'text/plain' }, { data: new Uint8Array([1]) }]) {
      expect(ExportTaskFileSchema.safeParse({ ...file, ...patch }).success).toBe(false);
    }
  });
});
