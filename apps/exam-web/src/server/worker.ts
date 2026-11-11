// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-review-hardening.md
// Decision: .agents/notes/implemented/architecture/2026-11-02-managed-exam-foundation.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-durable-exam-reviews.md
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { z } from 'zod';
import { solveOnDevice, type LocalFetch, type PhaseTimer } from '@solveflow/agent/mobile';
import { SolverInputSchema, type PublicAgentEvent, type SolveOutcome } from '@solveflow/contracts/agent';
import { WebStoredModelsSchema } from '@solveflow/contracts/local';
import { admitCall, claimJob, finishJob, heartbeatJob, jobImages, jobVerificationTarget, publishDraft, recoverJobs, setJobPhase, settleCall, type ExamJob } from '@solveflow/db';
import type { ExamStorage } from './storage.js';
import { prepareActViews, solverImage } from './images.js';
export type ExamSolver = (job: ExamJob, signal: AbortSignal, onEvent: (event: PublicAgentEvent) => void) => Promise<SolveOutcome>;
function callError(signal: AbortSignal, status?: number) {
    const reason: unknown = signal.reason;
    if (signal.aborted) {
        if (reason instanceof Error && ['MODEL_FIRST_CONTENT_TIMEOUT','MODEL_STREAM_IDLE_TIMEOUT'].includes(reason.message)) return reason.message;
        return 'MODEL_PHASE_ABORTED';
    }
    return status && status >= 400 ? 'HTTP_' + status : 'MODEL_NETWORK_ERROR';
}
export function modelSolver(pool: Pool, storage: ExamStorage, source: z.infer<typeof WebStoredModelsSchema> | ((job: ExamJob) => Promise<z.infer<typeof WebStoredModelsSchema>>), limits: {
    solver: number;
    verifier: number;
    daily: number;
}, network: typeof fetch = fetch, schedule?: PhaseTimer): ExamSolver {
    if (typeof source !== 'function' && (!source.keys.solver || !source.keys.verifier || !source.models.verifier))
        throw new Error('EXPLICIT_SOLVER_AND_VERIFIER_REQUIRED');
    return async (job, signal, onEvent) => {
        const models = typeof source === 'function' ? await source(job) : source, keys = models.keys, solverKey = keys.solver;
        if (!solverKey || !keys.verifier || !models.models.verifier) throw new Error('EXPLICIT_SOLVER_AND_VERIFIER_REQUIRED');
        const images = await jobImages(pool, job);
        const primary = images.find(i => i.role === 'primary');
        if (!primary)
            throw new Error('IMAGE_UNAVAILABLE');
        const input = SolverInputSchema.parse({ schemaVersion: 1, role: 'solver', identity: { ownerId: job.studentId, sessionId: job.slotId, runId: job.id }, exam: job.exam, subject: job.module.subject, verificationTarget: await jobVerificationTarget(pool, job), answerMode: 'brief', verificationMode: 'automatic', message: `当前模块：${job.module.title}；题型范围：${job.module.responseKinds.join('、')}。${job.module.wordLimit ? '作文最多' + job.module.wordLimit + '词。' : ''}${job.module.promptChoices ? '题面有' + job.module.promptChoices + '个可选写作题，只完成学生所拍的一题，不把备选题展开。' : ''} 同一道题的小问完整保留；只解答当前题位。`, evidence: [], image: { bytes: await solverImage(await storage.get(primary.key, signal)), mimeType: 'image/jpeg' }, materials: await Promise.all(images.filter(i => i.role === 'material').map(async (i) => ({ id: i.id, image: { bytes: await storage.get(i.key, signal), mimeType: 'image/jpeg' } }))) });
        let dispatchRole: 'solver' | 'verifier' = 'solver';
        let activeProgress: { errorCode: string | null } | undefined;
        const report = (event: PublicAgentEvent) => { if (event.type === 'run.status') {
            dispatchRole = event.status === 'verifying' ? 'verifier' : 'solver';
        } onEvent(event); };
        const transport: LocalFetch = Object.assign(async (url: Parameters<LocalFetch>[0], init?: RequestInit, onDispatch?: () => void) => {
            const requestSignal = AbortSignal.any([signal, ...init?.signal ? [init.signal] : []]);
            requestSignal.throwIfAborted();
            const profile = z.object({ model: z.string().min(1).max(200) }).parse(typeof init?.body === 'string' ? JSON.parse(init.body) : null).model;
            const role = dispatchRole;
            let callId: string | null = null;
            while (!callId) {
                requestSignal.throwIfAborted();
                callId = await admitCall(pool, job, role, profile, limits);
                if (!callId)
                    await delay(300, undefined, { signal: requestSignal });
            }
            const ticket = callId;
            const started = Date.now();
            const progress: { errorCode: string | null } = {errorCode: null};
            activeProgress = progress;
            let settled = false, httpStatus: number | undefined;
            const done = async (success: boolean) => {
                if (settled) return;
                settled = true;
                const errorCode = success ? null : progress.errorCode ?? callError(requestSignal, httpStatus);
                await settleCall(pool, ticket, success, errorCode);
                if (activeProgress === progress) activeProgress = undefined;
                const endpoint = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
                console.warn(JSON.stringify({source:'exam-worker',event:'model_call_finished',runId:job.id,callId:ticket,role,model:profile,provider:new URL(endpoint).hostname,durationMs:Math.max(0,Date.now()-started),httpStatus: httpStatus ?? null,errorCode}));
            };
            try {
                requestSignal.throwIfAborted();
                onDispatch?.();
                const response = await network(url, { ...init, signal: requestSignal });
                httpStatus = response.status;
                // Hold the permit until the response stream finishes, not just response headers.
                if (!response.body) {
                    await done(response.ok);
                    return response;
                }
                const reader = response.body.getReader();
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
                        try { await done(false); controller.error(error); }
                        finally { reader.releaseLock(); }
                    } }, async cancel() { try {
                        await reader.cancel();
                    }
                    finally {
                        try { await done(false); }
                        finally { reader.releaseLock(); }
                    } } });
                return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
            }
            catch (error) {
                await done(false);
                throw error;
            }
        }, {defersDispatch:true});
        return solveOnDevice(input, { ...models.models, schemaVersion: 1 }, { ...keys, solver: solverKey }, transport, signal, report,
            row => {
                // The SDK replaces abort reasons. Capture the trusted phase diagnostic
                // before abort, scoped to this call so late settlement cannot relabel a takeover.
                if (activeProgress && row.event === 'failure') {
                    if (row.reason === 'first_content_timeout') activeProgress.errorCode = 'MODEL_FIRST_CONTENT_TIMEOUT';
                    else if (row.reason === 'stream_idle') activeProgress.errorCode = 'MODEL_STREAM_IDLE_TIMEOUT';
                }
                console.warn(JSON.stringify({ source: 'exam-worker', ...row }));
            }, schedule,
            // Show the solver answer while verification still runs; finishJob or cancelJob
            // removes the draft, and the snapshot only exposes it for the unfinished run.
            { candidate: async candidate => { try { await publishDraft(pool, job, candidate); } catch (error) { console.warn(JSON.stringify({ source: 'exam-worker', event: 'draft_failed', runId: job.id, message: error instanceof Error ? error.message : String(error) })); } }, verification: async () => async () => {} },
            prepareActViews);
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
