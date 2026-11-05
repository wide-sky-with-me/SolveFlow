// Decision: .agents/notes/implemented/architecture/2026-11-05-exam-client-recovery.md
// Decision: .agents/notes/implemented/architecture/2026-11-04-managed-list-pagination.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-teacher-question-actions.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-console-dashboard.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-resolution-notifications.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-answer-presentation.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-durable-exam-reviews.md
import { z } from 'zod';
import { ExamTypeSchema } from './exam.js';
import { SolveOutcomeSchema, ProblemStatementSchema, MAX_ANSWER_CHARACTERS } from './agent.js';
import { MAX_MATERIAL_IMAGES, MAX_QUESTION_IMAGE_BYTES } from './material.js';
export const EXAM_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const EXAM_MODEL_IMAGE_BYTES = 4 * 1024 * 1024;
export const ExamMediaViewSchema = z.enum(['model', 'source', 'thumbnail']);
export type ExamMediaView = z.infer<typeof ExamMediaViewSchema>;
export const EXAM_QUESTION_IMAGE_BYTES = MAX_QUESTION_IMAGE_BYTES;
export const EXAM_MATERIAL_COUNT = MAX_MATERIAL_IMAGES;
const id = z.uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
export const ExamRoleSchema = z.enum(['student', 'support', 'manager', 'admin']);
export type ExamRole = z.infer<typeof ExamRoleSchema>;
export const ExamUserSchema = z.strictObject({ id, username: text(64), displayName: text(80), state: z.enum(['active', 'disabled', 'archived']), roles: z.array(ExamRoleSchema).min(1).max(4) });
export type ExamUser = z.infer<typeof ExamUserSchema>;
export const ExamLoginSchema = z.strictObject({ username: text(64), password: z.string().min(1).max(256) });
export const ExamUserCreateSchema = z.strictObject({ username: text(64).regex(/^[A-Za-z0-9_-]{3,64}$/), displayName: text(80), password: z.string().min(12).max(128), roles: z.array(ExamRoleSchema).min(1).max(4).refine(v => new Set(v).size === v.length) });
export const ExamUserUpdateSchema = z.strictObject({ displayName: text(80), state: z.enum(['active', 'disabled']), roles: z.array(ExamRoleSchema).min(1).max(4), password: z.string().min(12).max(128).optional() });
export const ExamResponseKindSchema = z.enum(['single-choice', 'multiple-choice', 'numeric', 'short-answer', 'essay', 'multipart', 'drawing']);
export const ExamModuleSchema = z.strictObject({ code: text(40).regex(/^[a-z0-9-]+$/), title: text(80), sectionCode: text(40), questionCount: z.number().int().min(1).max(300), durationSeconds: z.number().int().min(60).max(86400).nullable(), subject: text(40).default('general'), responseKinds: z.array(ExamResponseKindSchema).min(1).max(7).default(['single-choice', 'numeric', 'short-answer', 'essay', 'multipart', 'drawing', 'multiple-choice']), calculator: z.enum(['allowed', 'required', 'forbidden', 'unspecified']).default('unspecified'), promptChoices: z.number().int().min(1).max(10).nullable().default(null), wordLimit: z.number().int().min(1).max(10000).nullable().default(null) });
export type ExamModule = z.infer<typeof ExamModuleSchema>;
export const ExamTemplateCreateSchema = z.strictObject({ code: text(40).regex(/^[a-z0-9-]+$/), title: text(120), exam: ExamTypeSchema, reference: z.strictObject({ catalogCode: text(80), edition: text(80), checkedOn: z.iso.date(), sources: z.array(z.url().refine(v => v.startsWith('https://'))).min(1).max(5) }).nullable().default(null), modules: z.array(ExamModuleSchema).min(1).max(16).refine(v => new Set(v.map(m => m.code)).size === v.length) });
export const ExamTemplateSchema = ExamTemplateCreateSchema.extend({ id, version: z.number().int().positive() });
export type ExamTemplate = z.infer<typeof ExamTemplateSchema>;
export const ExamSittingCreateSchema = z.strictObject({ templateId: id, title: text(120), opensAt: z.iso.datetime({ offset: true }), closesAt: z.iso.datetime({ offset: true }).nullable() }).refine(v => v.closesAt === null || Date.parse(v.closesAt) > Date.parse(v.opensAt), '结束时间须晚于开始时间');
export const ExamSittingSchema = z.strictObject({ id, templateId: id, title: text(120), opensAt: z.iso.datetime({ offset: true }), closesAt: z.iso.datetime({ offset: true }).nullable(), state: z.enum(['draft', 'published', 'closed', 'cancelled']) });
export type ExamSitting = z.infer<typeof ExamSittingSchema>;
export const ExamAssignmentCreateSchema = z.strictObject({ sittingId: id, studentId: id, supportIds: z.array(id).max(32).default([]), mode: z.enum(['original', 'practice_simulation']).default('original'), wrongCounts: z.array(z.number().int().min(0).max(300)).max(16).default([]) });
const uniqueIds = (max: number) => z.array(id).max(max).refine(ids => new Set(ids).size === ids.length, '不能重复选择');
export const EXAM_ALLOCATION_BATCH = 100;
const allocationFields = {
    studentIds: uniqueIds(EXAM_ALLOCATION_BATCH).min(1), supportIds: uniqueIds(32).default([]),
    mode: z.enum(['original', 'practice_simulation']).default('original'), wrongCounts: z.array(z.number().int().min(0).max(300)).max(16).default([]),
};
export const ExamSittingPublishSchema = z.strictObject({ requestId: id, sitting: ExamSittingCreateSchema, ...allocationFields });
export const ExamAllocationAddSchema = z.strictObject({ requestId: id, ...allocationFields });
export const ExamAllocationStaffSchema = z.strictObject({ requestId: id, expectedVersion: z.number().int().positive(), supportIds: uniqueIds(32) });
export const ExamAllocationStateSchema = z.strictObject({ requestId: id, expectedVersion: z.number().int().positive(), action: z.enum(['revoke', 'restore']) });
export const ExamAllocationSchema = z.strictObject({ id, student: ExamUserSchema, support: z.array(ExamUserSchema).max(32), state: z.enum(['assigned','revoked','completed']), started: z.boolean(), version: z.number().int().positive() });
export type ExamAllocation = z.infer<typeof ExamAllocationSchema>;
export const ExamAssignmentEntrySchema = z.enum(['available', 'upcoming', 'ended', 'expired', 'revoked', 'unavailable']);
export const ExamAssignmentSchema = z.strictObject({ id, studentId: id, studentName: text(80), sittingId: id, title: text(120), exam: ExamTypeSchema, opensAt: z.iso.datetime({ offset: true }), closesAt: z.iso.datetime({ offset: true }).nullable(), state: z.enum(['assigned', 'revoked', 'completed']), attemptId: id.nullable(), attemptEnded: z.boolean().default(false), expired: z.boolean().default(false), pendingReviewCount: z.number().int().nonnegative().default(0), entryState: ExamAssignmentEntrySchema.nullable().default(null) });
export type ExamAssignment = z.infer<typeof ExamAssignmentSchema>;
export const ExamSubmissionSchema = z.strictObject({ requestId: id, expectedRevision: z.number().int().min(0), kind: z.enum(['initial', 'retake', 'supplement']), assetIds: z.array(id).min(1).max(EXAM_MATERIAL_COUNT + 1).refine(v => new Set(v).size === v.length) });
export type ExamSubmission = z.infer<typeof ExamSubmissionSchema>;
export const ExamSubmissionReceiptSchema = z.strictObject({ runId: id.nullable() });
const navigationFields = { requestId: id, expectedVersion: z.number().int().nonnegative() };
export const ExamNavigationSchema = z.discriminatedUnion('action', [
    z.strictObject({ ...navigationFields, action: z.literal('select_slot'), slotId: id }),
    z.strictObject({ ...navigationFields, action: z.literal('select_module'), moduleId: id }),
    z.strictObject({ ...navigationFields, action: z.literal('skip_slot'), slotId: id }),
    z.strictObject({ ...navigationFields, action: z.literal('skip_module'), moduleId: id }),
]);
export type ExamNavigation = z.infer<typeof ExamNavigationSchema>;
type NavigationAction<T> = T extends ExamNavigation ? Omit<T, 'requestId' | 'expectedVersion'> : never;
export type ExamNavigationAction = NavigationAction<ExamNavigation>;
export const ExamNavigationResultSchema = z.strictObject({ id, slotId: id.nullable(), navigationVersion: z.number().int().nonnegative() });
export const ExamActivitySchema = z.strictObject({ id, action: z.enum(['select_slot', 'select_module', 'skip_slot', 'skip_module']), moduleTitle: text(80), position: z.number().int().positive().nullable(), targetSlotId: id.nullable(), affectedCount: z.number().int().nonnegative(), createdAt: z.iso.datetime({ offset: true }) });
export const ExamUploadQuerySchema = z.strictObject({ slotId: id });
export const ExamPresentationSchema = z.strictObject({ answer: z.string().max(MAX_ANSWER_CHARACTERS), selectedOptions: z.array(text(10)).max(10).nullable(), simulated: z.boolean(), verified: z.boolean(), humanConfirmed: z.boolean().default(false), notAppliedReason: z.string().max(200).nullable() }).refine(v => !v.humanConfirmed || (!v.verified && !v.simulated));
export type ExamPresentation = z.infer<typeof ExamPresentationSchema>;
/** Shared by the teacher form and server; selection is the single source for choice answers. */
export function formatExamChoiceAnswer(options: readonly { label: string; text: string }[], selected: readonly string[]): string | null {
    if (!selected.length || new Set(selected).size !== selected.length) return null;
    const answers: string[] = [];
    for (const label of selected) {
        const option = options.find(value => value.label === label);
        if (!option) return null;
        answers.push(label + '. ' + option.text);
    }
    const answer = answers.join('\n');
    return answer.length <= MAX_ANSWER_CHARACTERS ? answer : selected.join('、');
}
export const ExamAlertReasonSchema = z.enum(['verification_failed', 'verification_unknown', 'verification_unavailable', 'answer_failed', 'image_incomplete', 'interrupted', 'response_mismatch']);
export const ExamAlertSchema = z.strictObject({ id, slotId: id, moduleId: id, moduleTitle: text(80), position: z.number().int().positive(), revision: z.number().int().positive(), reason: ExamAlertReasonSchema, openedAt: z.iso.datetime({ offset: true }) });
export type ExamAlert = z.infer<typeof ExamAlertSchema>;
export const ExamResolutionSchema = z.strictObject({ id, slotId: id, moduleId: id, moduleTitle: text(80), position: z.number().int().positive(), revision: z.number().int().positive(), resolution: z.enum(['ai_pass', 'human_confirmed']), resolvedAt: z.iso.datetime({ offset: true }) });
export type ExamResolution = z.infer<typeof ExamResolutionSchema>;
export const ExamIssueQueueQuerySchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: text(512).optional(), q: z.string().trim().max(120).optional(), sittingId: id.optional(), studentId: id.optional(), reason: ExamAlertReasonSchema.optional() });
export const ExamIssueQueueItemSchema = ExamAlertSchema.extend({ attemptId: id, studentId: id, studentName: text(80), title: text(120) });
export type ExamIssueQueueItem = z.infer<typeof ExamIssueQueueItemSchema>;
export const ExamIssueQueueSchema = z.strictObject({ items: z.array(ExamIssueQueueItemSchema).max(100), total: z.number().int().nonnegative(), nextCursor: text(512).nullable() });
export const ExamSlotSchema = z.strictObject({ id, moduleId: id, position: z.number().int().positive(), ordinal: z.number().int().positive(), revision: z.number().int().nonnegative(), status: z.enum(['empty', 'queued', 'understanding', 'solving', 'verifying', 'revising', 'completed', 'needs_clarification', 'failed', 'cancelled', 'interrupted']), completedOnce: z.boolean(), deferred: z.boolean().default(false), skipped: z.boolean().default(false), runId: id.nullable(), reviewId: id.nullable().default(null), errorCode: z.string().max(100).nullable(), presentation: ExamPresentationSchema.nullable(), images: z.array(z.strictObject({ id, role: z.enum(['primary', 'material']) })).max(EXAM_MATERIAL_COUNT + 1) });
export type ExamSlot = z.infer<typeof ExamSlotSchema>;
export const ExamTimingSchema = z.strictObject({
    startedAt: z.iso.datetime({ offset: true }).nullable(), endedAt: z.iso.datetime({ offset: true }).nullable(),
    endedBy: z.enum(['student','teacher','deadline','system']).nullable(), elapsedSeconds: z.number().int().nonnegative(),
    remainingSeconds: z.number().int().nonnegative().nullable(), serverNow: z.iso.datetime({ offset: true }),
});
export type ExamTiming = z.infer<typeof ExamTimingSchema>;
const legacyTiming = { startedAt: null, endedAt: null, endedBy: null, elapsedSeconds: 0, remainingSeconds: null, serverNow: '1970-01-01T00:00:00.000Z' } as const;
export const ExamAttemptSchema = z.strictObject({ id, assignmentId: id, studentId: id, studentName: text(80), title: text(120), exam: ExamTypeSchema, timing: ExamTimingSchema.default(legacyTiming), state: z.enum(['ready', 'in_progress', 'completed', 'closed', 'cancelled']), opensAt: z.iso.datetime({ offset: true }), closesAt: z.iso.datetime({ offset: true }).nullable(), nextSlotId: id.nullable(), latestAnswerSlotId: id.nullable().default(null), viewedSlotId: id.nullable().default(null), lastSeq: z.number().int().nonnegative(), navigationVersion: z.number().int().nonnegative().default(0), activity: z.array(ExamActivitySchema).max(30).default([]), simulation: z.boolean(), modules: z.array(ExamModuleSchema.extend({ id, position: z.number().int().positive(), state: z.enum(['locked', 'available', 'in_progress', 'completed']) })).max(16), slots: z.array(ExamSlotSchema).max(4800), alerts: z.array(ExamAlertSchema).max(4800).default([]), resolutions: z.array(ExamResolutionSchema).max(4800).default([]) });
export type ExamAttempt = z.infer<typeof ExamAttemptSchema>;
export const ExamHumanReviewSchema = z.strictObject({ id, revision: z.number().int().positive(), teacherName: text(80), answer: text(MAX_ANSWER_CHARACTERS), selectedOptions: z.array(text(10)).max(10).nullable(), note: text(2000), createdAt: z.iso.datetime({ offset: true }) });
export const ExamDetailSchema = z.strictObject({ slot: ExamSlotSchema, problem: ProblemStatementSchema.nullable(), outcome: SolveOutcomeSchema.nullable(), humanReviews: z.array(ExamHumanReviewSchema).max(100).default([]), revisions: z.array(z.strictObject({ revision: z.number().int().positive(), reason: text(20), createdAt: z.iso.datetime({ offset: true }) })).max(100) });
const reviewVersion = { requestId: id, expectedRevision: z.number().int().positive(), expectedRunId: id.nullable(), expectedReviewId: id.nullable().default(null) };
export const ExamTeacherRunSchema = z.strictObject({ ...reviewVersion, action: z.enum(['solve', 'verify']) });
export const ExamTeacherConfirmSchema = z.strictObject({ ...reviewVersion, answer: text(MAX_ANSWER_CHARACTERS), selectedOptions: z.array(text(10)).min(1).max(10).refine(v => new Set(v).size === v.length).nullable(), note: text(2000) });
export const ExamDeferSchema = z.strictObject({ expectedRevision: z.number().int().positive(), expectedRunId: id });
export const ExamEventSchema = z.strictObject({ schemaVersion: z.literal(1), attemptId: id, seq: z.number().int().positive(), type: text(80) });
export const ExamEventsSchema = z.strictObject({ events: z.array(ExamEventSchema).max(100), lastSeq: z.number().int().nonnegative(), reset: z.boolean() });
export const ExamWsClientSchema = z.discriminatedUnion('type', [z.strictObject({ type: z.literal('subscribe'), attemptId: id, afterSeq: z.number().int().nonnegative() }), z.strictObject({ type: z.literal('heartbeat') })]);
export const ExamWsServerSchema = z.discriminatedUnion('type', [z.strictObject({ type: z.literal('changed'), attemptId: id, lastSeq: z.number().int().nonnegative() }), z.strictObject({ type: z.literal('heartbeat') })]);
export const ExamSessionSchema = z.strictObject({ user: ExamUserSchema, expiresAt: z.iso.datetime({ offset: true }) });
export const ExamProgressSchema = z.strictObject({ timing: ExamTimingSchema.default(legacyTiming), assignmentId: id, attemptId: id.nullable(), studentName: text(80), title: text(120), moduleTitle: z.string(), currentPosition: z.number().int().positive().nullable().default(null), skipped: z.number().int().nonnegative().default(0), unphotographed: z.number().int().nonnegative().default(0), navigationAt: z.iso.datetime({ offset: true }).nullable().default(null), answered: z.number().int().nonnegative(), verified: z.number().int().nonnegative(), humanConfirmed: z.number().int().nonnegative().default(0), total: z.number().int().nonnegative(), active: z.number().int().nonnegative(), attention: z.number().int().nonnegative(), online: z.boolean() });
const count = z.number().int().nonnegative();
export const ExamDashboardQuerySchema = z.strictObject({ sittingId: id.optional() });
export const ExamDashboardSchema = z.strictObject({
    generatedAt: z.iso.datetime({ offset: true }),
    sittings: z.array(z.strictObject({ id, title: text(120) })).max(200),
    summary: z.strictObject({ students: count, online: count, total: count, answered: count, verified: count, humanConfirmed: count, active: count, attention: count }),
    distribution: z.array(z.strictObject({ state: z.enum(['unphotographed', 'processing', 'attention', 'answered', 'waiting']), count })).length(5),
    throughput: z.array(z.strictObject({ at: z.iso.datetime({ offset: true }), ai: count, human: count })).length(12),
    issues: z.array(z.strictObject({ reason: ExamAlertReasonSchema, count })).max(7),
    modules: z.array(z.strictObject({ exam: ExamTypeSchema, title: text(80), sectionCode: text(40), total: count, answered: count, attention: count })).max(8),
    students: z.array(ExamProgressSchema).max(8),
});
export type ExamDashboard = z.infer<typeof ExamDashboardSchema>;

export const ExamPageQuerySchema = z.strictObject({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(120).default(''),
    selectedId: id.optional(),
});
export type ExamPageQuery = z.infer<typeof ExamPageQuerySchema>;
export function examPageSchema<T extends z.ZodType>(item: T) {
    return z.strictObject({ items: z.array(item).max(100), total: count, page: count.min(1), pageSize: count.min(1).max(100), selected: item.nullable() });
}
export const ExamUserPageQuerySchema = ExamPageQuerySchema.extend({ role: ExamRoleSchema.optional(), state: ExamUserSchema.shape.state.optional(), purpose: z.enum(['management', 'student-assignment', 'support-assignment']).default('management') });
export const ExamTemplatePageQuerySchema = ExamPageQuerySchema.extend({ exam: ExamTypeSchema.optional() });
export const ExamSittingPageQuerySchema = ExamPageQuerySchema.extend({ state: ExamSittingSchema.shape.state.optional(), exam: ExamTypeSchema.optional() });
export const ExamAssignmentPageQuerySchema = ExamPageQuerySchema.extend({ entryState: z.literal('1').optional(), state: z.enum(['available', 'upcoming', 'ended', 'expired', 'attention', 'revoked']).optional(), sittingId: id.optional(), studentId: id.optional(), excludeAttemptId: id.optional() });
export const ExamProgressPageQuerySchema = ExamPageQuerySchema.extend({ status: z.enum(['online', 'attention', 'active']).optional(), sittingId: id.optional() });
export const ExamUserPageSchema = examPageSchema(ExamUserSchema);
export const ExamTemplatePageSchema = examPageSchema(ExamTemplateSchema);
export const ExamSittingListItemSchema = ExamSittingSchema.extend({ templateTitle: z.string(), assignmentCount: count });
export const ExamSittingPageSchema = examPageSchema(ExamSittingListItemSchema);
export const ExamAllocationPageSchema = examPageSchema(ExamAllocationSchema).extend({ sitting: ExamSittingSchema });
export const ExamAssignmentPageSchema = examPageSchema(ExamAssignmentSchema).extend({ available: z.array(ExamAssignmentSchema).max(2), attentionTotal: count, missedTotal: count.default(0) });
export const ExamProgressPageSchema = examPageSchema(ExamProgressSchema).extend({ onlineTotal: count });
export const ExamChoiceSchema = z.strictObject({ id, label: text(200) });
export const ExamChoicePageSchema = examPageSchema(ExamChoiceSchema);
