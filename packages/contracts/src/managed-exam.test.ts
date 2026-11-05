import { describe, expect, it } from 'vitest';
import { ExamAssignmentCreateSchema, ExamSittingCreateSchema, ExamSubmissionSchema, ExamTemplateCreateSchema, ExamUserCreateSchema } from './managed-exam.js';
const id = '00000000-0000-4000-8000-000000000001';
describe('managed exam input boundaries', () => {
    it('rejects identity injection, duplicate assets and unbounded image lists', () => {
        const base = { requestId: id, expectedRevision: 0, kind: 'initial', assetIds: [id] };
        expect(ExamSubmissionSchema.safeParse(base).success).toBe(true);
        for (const extra of [{ studentId: id }, { expectedRevision: -1 }, { assetIds: [id, id] }, { assetIds: Array(9).fill(id) }])
            expect(ExamSubmissionSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    });
    it('requires a time window, bounded modules and unique module codes', () => {
        expect(ExamSittingCreateSchema.safeParse({ templateId: id, title: 'test', opensAt: '2026-11-02T09:00:00Z', closesAt: '2026-11-02T08:00:00Z' }).success).toBe(false);
        const module = { code: 'rw1', sectionCode: 'rw', title: '阅读一', questionCount: 27, durationSeconds: 1920 };
        expect(ExamTemplateCreateSchema.safeParse({ code: 'sat', title: 'SAT', exam: 'sat', modules: [module, module] }).success).toBe(false);
        expect(ExamAssignmentCreateSchema.safeParse({ sittingId: id, studentId: id, mode: 'practice_simulation', wrongCounts: [301] }).success).toBe(false);
    });
    it('allows an explicit unlimited schedule without trusting a client timer', () => {
        const base = { templateId: id, title: '不限时', opensAt: '2026-11-04T09:00:00Z', closesAt: null };
        expect(ExamSittingCreateSchema.parse(base).closesAt).toBeNull();
        for (const extra of [{ startedAt: base.opensAt }, { elapsedSeconds: 10 }, { endedAt: base.opensAt }])
            expect(ExamSittingCreateSchema.safeParse({ ...base, ...extra }).success).toBe(false);
        expect(ExamSittingCreateSchema.safeParse({ ...base, closesAt: base.opensAt }).success).toBe(false);
    });
    it('rejects weak credentials and undeclared roles', () => {
        expect(ExamUserCreateSchema.safeParse({ username: 'student', displayName: '学生', password: 'short', roles: ['student'] }).success).toBe(false);
        expect(ExamUserCreateSchema.safeParse({ username: 'student', displayName: '学生', password: 'synthetic-password', roles: ['superuser'] }).success).toBe(false);
    });
});

import { buildCatalogTemplate, EXAM_CATALOG } from './exam-catalog.js';
import { ExamPresentationSchema, ExamTeacherConfirmSchema, ExamTeacherRunSchema } from './managed-exam.js';
describe('official format snapshots and intervention contracts', () => {
    it('keeps all supported exam families, latest AP versions and response kinds explicit', () => {
        expect(new Set(EXAM_CATALOG.map(e => e.exam))).toEqual(new Set(['sat', 'act', 'esat', 'tmua', 'tara', 'ap']));
        expect(buildCatalogTemplate({ code: 'sat-digital' }).modules.map(m => [m.questionCount, m.durationSeconds])).toEqual([[27, 1920], [27, 1920], [22, 2100], [22, 2100]]);
        const act = buildCatalogTemplate({ code: 'act-enhanced', science: true, writing: true });
        expect(act.modules.map(m => m.questionCount)).toEqual([50, 45, 36, 40, 1]);
        expect(act.modules[3]?.durationSeconds).toBe(2400);
        expect(buildCatalogTemplate({ code: 'act-legacy' }).modules.map(m => m.questionCount)).toEqual([75, 60, 40, 40]);
        expect(buildCatalogTemplate({ code: 'tmua' }).modules.map(m => m.durationSeconds)).toEqual([4500, 4500]);
        const tara = buildCatalogTemplate({ code: 'tara' }).modules[2];
        expect(tara).toMatchObject({ questionCount: 1, promptChoices: 3, wordLimit: 750, responseKinds: ['essay'] });
        expect(buildCatalogTemplate({ code: 'ap-calculus-ab-2027' }).modules.map(m => m.questionCount)).toEqual([29, 13, 2, 4]);
        expect(buildCatalogTemplate({ code: 'ap-statistics-2027' }).modules.map(m => m.questionCount)).toEqual([42, 4]);
        for (const e of EXAM_CATALOG) expect(ExamTemplateCreateSchema.safeParse(e).success).toBe(true);
    });
    it('does not invent ESAT electives or accept irrelevant exam options', () => {
        expect(buildCatalogTemplate({ code: 'esat', esatSubjects: ['biology', 'chemistry'] }).modules.map(m => m.code)).toEqual(['math-1', 'biology', 'chemistry']);
        for (const input of [{ code: 'esat', esatSubjects: ['physics', 'physics'] }, { code: 'sat-digital', science: true }, { code: 'tara', writing: true }, { code: 'ap' }, { code: 'tmua', esatSubjects: ['physics'] }]) expect(() => buildCatalogTemplate(input)).toThrow();
    });
    it('requires reviewed versions, actual notes and distinct human verification', () => {
        const base = { requestId: id, expectedRevision: 1, expectedRunId: id };
        expect(ExamTeacherRunSchema.parse({ ...base, action: 'solve' }).expectedReviewId).toBeNull();
        expect(ExamTeacherConfirmSchema.parse({ ...base, expectedReviewId: id, answer: 'B', selectedOptions: ['B'], note: '已检查。' }).expectedReviewId).toBe(id);
        expect(ExamTeacherRunSchema.safeParse({ ...base, expectedReviewId: 'stale', action: 'solve' }).success).toBe(false);
        expect(ExamTeacherRunSchema.safeParse({ ...base, expectedRevision: 0, action: 'solve' }).success).toBe(false);
        expect(ExamTeacherRunSchema.safeParse({ ...base, action: 'verify', ownerId: id }).success).toBe(false);
        expect(ExamTeacherConfirmSchema.safeParse({ ...base, answer: 'B', selectedOptions: ['B'], note: '' }).success).toBe(false);
        expect(ExamTeacherConfirmSchema.safeParse({ ...base, answer: 'B', selectedOptions: ['B'], note: '已检查题图与运算。' }).success).toBe(true);
        expect(ExamPresentationSchema.safeParse({ answer: 'B', selectedOptions: ['B'], simulated: false, verified: true, humanConfirmed: true, notAppliedReason: null }).success).toBe(false);
    });
});

import { ExamNavigationSchema } from './managed-exam.js';
describe('exam navigation boundaries', () => {
    it('requires stable targets and bounded trusted envelope fields', () => {
        const base = { requestId: id, expectedVersion: 0, action: 'select_slot', slotId: id };
        expect(ExamNavigationSchema.safeParse(base).success).toBe(true);
        for (const change of [{ studentId: id }, { action: 'finish_exam' }, { expectedVersion: -1 }, { moduleId: id }]) expect(ExamNavigationSchema.safeParse({ ...base, ...change }).success).toBe(false);
        expect(ExamNavigationSchema.safeParse({ requestId: id, expectedVersion: 0, action: 'skip_module', moduleId: id }).success).toBe(true);
    });
});


import { formatExamChoiceAnswer, ExamAttemptSchema, ExamIssueQueueQuerySchema } from './managed-exam.js';
describe('human choice formatting and recent-answer compatibility', () => {
    it('keeps single and multiple choices consistent and rejects missing labels', () => {
        const options = [{label:'A',text:'3'},{label:'B',text:'4'},{label:'C',text:'5'}];
        expect(formatExamChoiceAnswer(options,['C'])).toBe('C. 5');
        expect(formatExamChoiceAnswer(options,['B','C'])).toBe('B. 4\nC. 5');
        for (const labels of [[],['D'],['B','B']]) expect(formatExamChoiceAnswer(options,labels)).toBeNull();
        expect(formatExamChoiceAnswer([{label:'A',text:'x'.repeat(10000)}],['A'])).toBe('A');
    });
    it('accepts historical snapshots without inventing a recent answer', () => {
        const old = {id,assignmentId:id,studentId:id,studentName:'合成用户',title:'合成考试',exam:'sat',state:'in_progress',opensAt:'2026-11-03T00:00:00Z',closesAt:'2026-11-03T01:00:00Z',nextSlotId:null,lastSeq:1,simulation:false,modules:[],slots:[]};
        expect(ExamAttemptSchema.parse(old).latestAnswerSlotId).toBeNull();
        expect(ExamAttemptSchema.parse(old).resolutions).toEqual([]);
        expect(ExamAttemptSchema.parse({...old,latestAnswerSlotId:id}).latestAnswerSlotId).toBe(id);
    });
    it('bounds problem-list pagination and disallows scope injection', () => {
        expect(ExamIssueQueueQuerySchema.parse({})).toEqual({limit:30});
        expect(ExamIssueQueueQuerySchema.parse({limit:'100',studentId:id,reason:'answer_failed'}).limit).toBe(100);
        for (const input of [{limit:0},{limit:101},{cursor:'x'.repeat(513)},{studentId:'wrong'},{reason:'all'},{ownerId:id}])
            expect(ExamIssueQueueQuerySchema.safeParse(input).success).toBe(false);
    });
});

import { ExamPageQuerySchema, ExamUserPageQuerySchema } from './managed-exam.js';
describe('managed list page boundaries',()=>{
    it('bounds page size, search length and rejects identity injection',()=>{
        expect(ExamPageQuerySchema.parse({})).toEqual({page:1,pageSize:20,q:''});
        expect(ExamPageQuerySchema.parse({page:'2',pageSize:'100',q:' 姓名 '})).toEqual({page:2,pageSize:100,q:'姓名'});
        for(const value of [{page:0},{pageSize:101},{page:1.5},{q:'x'.repeat(121)},{ownerId:id},{selectedId:'invalid'}])expect(ExamPageQuerySchema.safeParse(value).success).toBe(false);
        expect(ExamUserPageQuerySchema.safeParse({role:'superuser'}).success).toBe(false);
    });
});

describe('issue sitting scope boundaries', () => {
    it('accepts a sitting filter without accepting owner injection or changing legacy defaults', () => {
        expect(ExamIssueQueueQuerySchema.parse({})).toEqual({ limit: 30 });
        expect(ExamIssueQueueQuerySchema.parse({ sittingId: id, limit: 1 }).sittingId).toBe(id);
        expect(ExamIssueQueueQuerySchema.safeParse({ sittingId: 'invalid' }).success).toBe(false);
        expect(ExamIssueQueueQuerySchema.safeParse({ sittingId: id, ownerId: id }).success).toBe(false);
    });
});

import { ExamAssignmentSchema, ExamAssignmentPageQuerySchema, ExamSubmissionReceiptSchema } from './managed-exam.js';
describe('server admission and submission receipts', () => {
    it('reads older assignments explicitly and bounds authoritative states', () => {
        const old = { id, studentId:id, studentName:'学生', sittingId:id, title:'考试', exam:'sat', opensAt:'2026-11-05T00:00:00Z', closesAt:null, state:'assigned', attemptId:null };
        expect(ExamAssignmentSchema.parse(old).entryState).toBeNull();
        expect(ExamAssignmentSchema.parse({...old,entryState:'upcoming'}).entryState).toBe('upcoming');
        expect(ExamAssignmentSchema.safeParse({...old,entryState:'force_start'}).success).toBe(false);
        expect(ExamAssignmentPageQuerySchema.parse({entryState:'1'}).entryState).toBe('1');
        expect(ExamAssignmentPageQuerySchema.safeParse({entryState:'true'}).success).toBe(false);
    });
    it('distinguishes a missing receipt without allowing injected ownership', () => {
        expect(ExamSubmissionReceiptSchema.parse({runId:null})).toEqual({runId:null});
        expect(ExamSubmissionReceiptSchema.parse({runId:id})).toEqual({runId:id});
        for(const extra of [{runId:'unknown'},{studentId:id},{accepted:true}])expect(ExamSubmissionReceiptSchema.safeParse({runId:null,...extra}).success).toBe(false);
    });
});
