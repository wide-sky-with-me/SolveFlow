// Decision: .agents/notes/implemented/rendering/2026-10-07-browser-history-reload.md
import { z } from 'zod';
import { LocalBatchSchema } from '@solveflow/contracts/local';
import type { CurrentPage, WorkspacePage } from './navigation-state';

const CurrentPageSchema = z.strictObject({
  page: z.literal('current'), questionId: z.uuid().optional(),
  batch: LocalBatchSchema.omit({ position: true }).extend({ selectedId: z.uuid().optional() }).optional(),
}).refine(value => !(value.questionId && value.batch));
const WorkspacePageSchema = z.union([
  CurrentPageSchema, z.strictObject({ page: z.enum(['history', 'profile', 'favorites']) }),
]);
const BrowserNavigationSchema = z.strictObject({
  schemaVersion: z.literal(1), epoch: z.uuid(), key: z.number().int().nonnegative().safe(),
  route: WorkspacePageSchema, current: CurrentPageSchema,
});
function currentPage(value: z.infer<typeof CurrentPageSchema>): CurrentPage {
  const batch = value.batch;
  return { page: 'current', ...(value.questionId ? { questionId: value.questionId } : {}),
    ...(batch ? { batch: { id: batch.id, title: batch.title, createdAt: batch.createdAt, exam: batch.exam, ...(batch.selectedId ? { selectedId: batch.selectedId } : {}) } } : {}),
  };
}
export function readBrowserNavigation(raw: unknown) {
  const parsed = BrowserNavigationSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  const route: WorkspacePage = value.route.page === 'current' ? currentPage(value.route) : { page: value.route.page };
  return { ...value, route, current: currentPage(value.current) };
}
/** Versioned browser entries contain navigation metadata, never question images or answers. */
export function browserNavigation(epoch: string, key: number, route: WorkspacePage, current: CurrentPage) {
  return { schemaVersion: 1, epoch, key, route, current };
}
