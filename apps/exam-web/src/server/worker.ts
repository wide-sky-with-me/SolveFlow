// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-review-hardening.md
// Decision: .agents/notes/implemented/architecture/2026-11-02-managed-exam-foundation.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-durable-exam-reviews.md
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { z } from 'zod';
import { solveOnDevice } from '@solveflow/agent/mobile';
import { SolverInputSchema, type PublicAgentEvent, type SolveOutcome } from '@solveflow/contracts/agent';
import { WebStoredModelsSchema } from '@solveflow/contracts/local';
import { admitCall, claimJob, finishJob, heartbeatJob, jobImages, jobVerificationTarget, recoverJobs, setJobPhase, settleCall, type ExamJob } from '@solveflow/db';
import type { ExamStorage } from './storage.js';
import { prepareActViews } from './images.js';
export type ExamSolver = (job: ExamJob, signal: AbortSignal, onEvent: (event: PublicAgentEvent) => void) => Promise<SolveOutcome>;
export function modelSolver(pool: Pool, storage: ExamStorage, models: z.infer<typeof WebStoredModelsSchema>, limits: {
    solver: number;
    verifier: number;
    daily: number;
}, network: typeof fetch = fetch): ExamSolver {
    const keys = models.keys;
    const solverKey = keys.solver;
    if (!solverKey || !keys.verifier || !models.models.solver || !models.models.verifier)
        throw new Error('EXPLICIT_SOLVER_AND_VERIFIER_REQUIRED');
    return async (job, signal, onEvent) => {
        const images = await jobImages(pool, job);
        const primary = images.find(i => i.role === 'primary');
        if (!primary)
            throw new Error('IMAGE_UNAVAILABLE');
        const input = SolverInputSchema.parse({ schemaVersion: 1, role: 'solver', identity: { ownerId: job.studentId, sessionId: job.slotId, runId: job.id }, exam: job.exam, subject: job.module.subject, verificationTarget: await jobVerificationTarget(pool, job), answerMode: 'brief', verificationMode: 'automatic', message: `当前模块：${job.module.title}；题型范围：${job.module.responseKinds.join('、')}。${job.module.wordLimit ? '作文最多' + job.module.wordLimit + '词。' : ''}${job.module.promptChoices ? '题面有' + job.module.promptChoices + '个可选写作题，只完成学生所拍的一题，不把备选题展开。' : ''} 同一道题的小问完整保留；只解答当前题位。`, evidence: [], image: { bytes: await storage.get(primary.key), mimeType: 'image/jpeg' }, materials: await Promise.all(images.filter(i => i.role === 'material').map(async (i) => ({ id: i.id, image: { bytes: await storage.get(i.key), mimeType: 'image/jpeg' } }))) });
        let dispatchRole: 'solver' | 'verifier' = 'solver';
        const report = (event: PublicAgentEvent) => { if (event.type === 'run.status') {
            dispatchRole = event.status === 'verifying' ? 'verifier' : 'solver';
        } onEvent(event); };
        const transport: typeof fetch = async (url, init) => {
            signal.throwIfAborted();
            const profile = z.object({ model: z.string().min(1).max(200) }).parse(typeof init?.body === 'string' ? JSON.parse(init.body) : null).model;
            const role = dispatchRole;
            let callId: string | null = null;
            while (!callId) {
                signal.throwIfAborted();
                callId = await admitCall(pool, job, role, profile, limits);
                if (!callId)
                    await delay(300, undefined, { signal });
            }
            const ticket = callId;
            try {
                const response = await network(url, { ...init, signal: AbortSignal.any([signal, ...init?.signal ? [init.signal] : []]) });
                // Hold the permit until the response stream finishes, not just response headers.
                if (!response.body) {
                    await settleCall(pool, ticket, response.ok);
                    return response;
                }
                const reader = response.body.getReader();
                let settled = false;
                const done = async (success: boolean) => { if (!settled) {
                    settled = true;
                    await settleCall(pool, ticket, success);
                } };
                const stream = new ReadableStream<Uint8Array>({ async pull(controller) { try {
                        const next = await reader.read();
                        if (next.done) {
                            await done(response.ok);
                            controller.close();
                            reader.releaseLock();
                        }
                        else
                            controller.enqueue(next.value);
                    }
                    catch (error) {
                        await done(false);
                        controller.error(error);
                    } }, async cancel() { try {
                        await reader.cancel();
                    }
                    finally {
                        await done(false);
                    } } });
                return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
            }
            catch (error) {
                await settleCall(pool, ticket, false);
                throw error;
            }
        };
        return solveOnDevice(input, { ...models.models, schemaVersion: 1 }, { ...keys, solver: solverKey }, transport, signal, report, undefined, undefined, undefined, prepareActViews);
    };
}
export async function processJob(pool: Pool, solve: ExamSolver, signal: AbortSignal) {
    const job = await claimJob(pool);
    if (!job)
        return false;
    const controller = new AbortController();
    const active = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(6 * 60000)]);
    let checking = false;
    const heartbeat = setInterval(() => { if (checking)
        return; checking = true; void heartbeatJob(pool, job).then(ok => { if (!ok)
        controller.abort(); }).catch(() => controller.abort()).finally(() => checking = false); }, 5000);
    let phase: string | undefined;
    try {
        let result: SolveOutcome | null = null, errorCode: string | null = null;
        try {
            result = await solve(job, active, event => { if (event.type === 'run.status' && event.status !== phase) {
                phase = event.status;
                if (event.status === 'solving' || event.status === 'verifying' || event.status === 'revising')
                    void setJobPhase(pool, job, event.status).catch(() => controller.abort());
            } });
            active.throwIfAborted();
        } catch (error) {
            if (controller.signal.aborted || signal.aborted) return true;
            result = null;
            errorCode = error instanceof Error && error.message.includes('额度') ? 'QUOTA_EXCEEDED' : 'SOLVE_FAILED';
        }
        // Retry the same result, never the paid solve. Every write still checks the current lease/revision.
        const saving = AbortSignal.any([signal, controller.signal]);
        for (let attempt = 0; ; attempt++) {
            saving.throwIfAborted();
            try {
                await finishJob(pool, job, result, errorCode);
                break;
            } catch (error) {
                if (attempt >= 3 || saving.aborted) throw error;
                await delay(250 * 2 ** attempt, undefined, { signal: saving });
            }
        }
    }
    finally {
        clearInterval(heartbeat);
    }
    return true;
}
export async function workerLoop(pool: Pool, solve: ExamSolver, signal: AbortSignal, concurrency: number) {
    const workers = Array.from({ length: concurrency }, async () => { while (!signal.aborted) {
        try {
            const worked = await processJob(pool, solve, signal);
            if (!worked)
                await delay(500, undefined, { signal });
        }
        catch {
            if (!signal.aborted) {
                console.error(JSON.stringify({ event: 'exam.worker.failed', code: 'WORKER_UNAVAILABLE' }));
                await delay(1000, undefined, { signal }).catch(() => { });
            }
        }
    } });
    let recoveryBusy = false;
    const recovery = setInterval(() => { if (recoveryBusy)
        return; recoveryBusy = true; void recoverJobs(pool).catch(() => console.error(JSON.stringify({ event: 'exam.recovery.failed' }))).finally(() => recoveryBusy = false); }, 10000);
    try {
        await recoverJobs(pool);
        await Promise.all(workers);
    }
    finally {
        clearInterval(recovery);
    }
}
