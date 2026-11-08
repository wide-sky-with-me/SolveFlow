import { describe, expect, it } from 'vitest';
import { ExamEventCreateSchema, ExamConcreteCreateSchema, ExamEventUpdateSchema } from './exam-events.js';
import { ExamTeacherMessageCreateSchema, ExamAssignmentPageQuerySchema } from './managed-exam.js';
const id = '00000000-0000-4000-8000-000000000001';
describe('event hierarchy and teacher-message boundaries', () => {
    it('derives concrete templates from the parent and rejects identity injection', () => {
        const parent = { requestId: id, title: '场次', templateId: id };
        expect(ExamEventCreateSchema.safeParse(parent).success).toBe(true);
        for (const extra of [{ managerId: id }, { studentIds: [id] }, { expectedVersion: 0 }])
            expect(ExamEventCreateSchema.safeParse({ ...parent, ...extra }).success).toBe(false);
        const exam = { requestId: id, title: '具体考试', opensAt: '2026-11-07T01:00:00Z', closesAt: null, studentIds: [id] };
        expect(ExamConcreteCreateSchema.safeParse(exam).success).toBe(true);
        for (const extra of [{ templateId: id }, { studentIds: [id, id] }, { closesAt: '2026-11-07T00:00:00Z' }])
            expect(ExamConcreteCreateSchema.safeParse({ ...exam, ...extra }).success).toBe(false);
        expect(ExamEventUpdateSchema.safeParse({ ...parent, expectedVersion: 0 }).success).toBe(false);
    });
    it('accepts message-only requests without relaxing answer confirmation', () => {
        const base = { requestId: id, expectedRevision: 0, message: '请补拍完整题目。' };
        expect(ExamTeacherMessageCreateSchema.safeParse(base).success).toBe(true);
        for (const extra of [{ answer: 'B' }, { selectedOptions: ['B'] }, { studentId: id }, { message: '  ' }, { message: 'x'.repeat(2001) }])
            expect(ExamTeacherMessageCreateSchema.safeParse({ ...base, ...extra }).success).toBe(false);
        expect(ExamAssignmentPageQuerySchema.safeParse({ phase: 'in_progress', messages: '1' }).success).toBe(true);
        expect(ExamAssignmentPageQuerySchema.safeParse({ phase: 'custom' }).success).toBe(false);
    });
});
