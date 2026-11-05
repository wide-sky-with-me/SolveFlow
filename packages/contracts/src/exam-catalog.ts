// Decision: .agents/notes/implemented/architecture/2026-11-03-durable-exam-reviews.md
// Official format snapshots, not scoring conversion tables or a question bank.
import { z } from 'zod';
import { ExamModuleSchema, ExamTemplateCreateSchema, type ExamModule } from './managed-exam.js';
const checkedOn = '2026-11-03';
const uat = 'https://esat-tmua.ac.uk/about-the-tests/';
const ap = 'https://apcentral.collegeboard.org/courses/';
function module(code: string, title: string, subject: string, count: number, minutes: number, responseKinds: ExamModule['responseKinds'] = ['single-choice'], calculator: ExamModule['calculator'] = 'forbidden', extra: Partial<ExamModule> = {}): ExamModule {
    return ExamModuleSchema.parse({ code, sectionCode: code, title, subject, questionCount: count, durationSeconds: minutes * 60, responseKinds, calculator, ...extra });
}
function entry(code: string, title: string, exam: 'sat' | 'act' | 'esat' | 'tmua' | 'tara' | 'ap', edition: string, source: string, modules: ExamModule[]) {
    return ExamTemplateCreateSchema.parse({ code, title, exam, reference: { catalogCode: code, edition, checkedOn, sources: [source] }, modules });
}
const actSource = 'https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/act-exam-sections-and-structure.html';
const entries = [
    entry('sat-digital', 'SAT · Digital', 'sat', 'Digital SAT', 'https://satsuite.collegeboard.org/sat/whats-on-the-test/structure', [module('rw-1', '阅读与写作一', 'english', 27, 32), module('rw-2', '阅读与写作二', 'english', 27, 32), module('math-1', '数学一', 'math', 22, 35, ['single-choice', 'numeric'], 'allowed'), module('math-2', '数学二', 'math', 22, 35, ['single-choice', 'numeric'], 'allowed')]),
    entry('act-enhanced', 'ACT · 新版', 'act', 'Enhanced 2026', actSource, [module('english', 'English', 'english', 50, 35), module('math', 'Mathematics', 'math', 45, 50, ['single-choice'], 'allowed'), module('reading', 'Reading', 'english', 36, 40)]),
    entry('act-legacy', 'ACT · 旧版练习', 'act', 'Legacy', 'https://www.act.org/content/dam/act/unsecured/documents/act-test-content.pdf', [module('english', 'English', 'english', 75, 45), module('math', 'Mathematics', 'math', 60, 60, ['single-choice'], 'allowed'), module('reading', 'Reading', 'english', 40, 35), module('science', 'Science', 'science', 40, 35)]),
    entry('esat', 'ESAT · 科目组合', 'esat', '2027 entry', uat + 'esat-test/', [module('math-1', 'Mathematics 1', 'math', 27, 40)]),
    entry('tmua', 'TMUA', 'tmua', '2027 entry', uat + 'tmua-test/', [module('paper-1', '应用数学知识', 'math', 20, 75), module('paper-2', '数学推理', 'math', 20, 75)]),
    entry('tara', 'TARA', 'tara', '2027 entry', uat + 'tara/', [module('critical-thinking', '批判性思维', 'reasoning', 22, 40), module('problem-solving', '问题求解', 'reasoning', 22, 40), module('writing', '写作', 'english', 1, 40, ['essay'], 'forbidden', { promptChoices: 3, wordLimit: 750 })]),
];
for (const course of ['ab', 'bc']) entries.push(entry('ap-calculus-' + course + '-2027', 'AP Calculus ' + course.toUpperCase() + ' · 2027', 'ap', 'May 2027', ap + 'ap-calculus-' + course + '/exam', [module('mcq-a', '选择题 A', 'math', 29, 62), module('mcq-b', '选择题 B', 'math', 13, 38, ['single-choice'], 'required'), module('frq-a', '解答题 A', 'math', 2, 30, ['multipart', 'short-answer', 'numeric', 'drawing'], 'required'), module('frq-b', '解答题 B', 'math', 4, 60, ['multipart', 'short-answer', 'numeric', 'drawing'])]));
for (const [course, title] of [['1', '1'], ['2', '2'], ['c-mechanics', 'C: Mechanics'], ['c-electricity-and-magnetism', 'C: Electricity and Magnetism']]) entries.push(entry('ap-physics-' + (course === 'c-electricity-and-magnetism' ? 'c-em' : course) + '-2027', 'AP Physics ' + title + ' · 2027', 'ap', 'May 2027', ap + 'ap-physics-' + course + '/exam', [module('mcq', '选择题', 'physics', 42, 85, ['single-choice'], 'allowed'), module('frq', '解答题', 'physics', 4, 95, ['multipart', 'short-answer', 'numeric', 'drawing'], 'allowed')]));
for (const [course, title, subject, mcq, mcqMinutes, frq, frqMinutes] of [
    ['chemistry', 'Chemistry', 'chemistry', 60, 90, 7, 105], ['biology', 'Biology', 'biology', 60, 90, 6, 90],
    ['statistics', 'Statistics', 'math', 42, 90, 4, 90], ['computer-science-a', 'Computer Science A', 'computer-science', 42, 90, 4, 90],
    ['microeconomics', 'Microeconomics', 'economics', 60, 70, 3, 60], ['macroeconomics', 'Macroeconomics', 'economics', 60, 70, 3, 60],
] as const) entries.push(entry('ap-' + course + '-2027', 'AP ' + title + ' · 2027', 'ap', 'May 2027', ap + 'ap-' + course + '/exam', [module('mcq', '选择题', subject, mcq, mcqMinutes, ['single-choice'], 'unspecified'), module('frq', '解答题', subject, frq, frqMinutes, ['multipart', 'short-answer', 'numeric', 'drawing'], 'unspecified')]));
export const EXAM_CATALOG = entries;
export const ExamCatalogRequestSchema = z.strictObject({ code: z.string().min(1).max(80), science: z.boolean().default(false), writing: z.boolean().default(false), esatSubjects: z.array(z.enum(['biology', 'chemistry', 'physics', 'math-2'])).max(4).default([]) });
export function buildCatalogTemplate(raw: unknown) {
    const input = ExamCatalogRequestSchema.parse(raw);
    const found = entries.find(e => e.code === input.code);
    if (!found) throw new Error('UNKNOWN_EXAM_CATALOG_ENTRY');
    const result = structuredClone(found);
    if (input.science && found.code !== 'act-enhanced' || input.writing && !['act-enhanced', 'act-legacy'].includes(found.code) || input.esatSubjects.length && found.code !== 'esat') throw new Error('EXAM_OPTION_NOT_APPLICABLE');
    if (found.code === 'esat') {
        // Some courses require fewer modules: choose the actual booking, never silently pick Physics.
        if (new Set(input.esatSubjects).size !== input.esatSubjects.length) throw new Error('DUPLICATE_ESAT_SUBJECT');
        const names = { biology: 'Biology', chemistry: 'Chemistry', physics: 'Physics', 'math-2': 'Mathematics 2' };
        for (const subject of input.esatSubjects) result.modules.push(module(subject, names[subject], subject === 'math-2' ? 'math' : subject, 27, 40));
        result.code += '-' + (input.esatSubjects.join('-') || 'math-only');
        result.title += ' · ' + result.modules.map(m => m.title).join(' / ');
    }
    if (input.science) { result.modules.push(module('science', 'Science', 'science', 40, 40)); result.code += '-s'; result.title += ' + Science'; }
    if (input.writing) { result.modules.push(module('writing', 'Writing', 'english', 1, 40, ['essay'])); result.code += '-w'; result.title += ' + Writing'; }
    // Catalog combinations can have long descriptive titles, but stable codes remain bounded.
    result.title = result.title.slice(0, 120);
    return ExamTemplateCreateSchema.parse(result);
}
