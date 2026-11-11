import { serve } from '@hono/node-server';
import { Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { bootstrap, connectDatabase, createTemplate, expireExams, migrate, templates } from '@solveflow/db';
import { loadExamConfig } from './config.js';
import { createExamService, hashPassword } from './service.js';
import { LocalExamStorage, PrivateS3Storage } from './storage.js';
import { connectCache, publishOutbox, realtime } from './realtime.js';
import { modelSolver, workerLoop } from './worker.js';
import { buildCatalogTemplate } from '@solveflow/contracts/exam-catalog';
import { collectGarbage } from './maintenance.js';
import { PracticeJobs } from './practice.js';
import { practiceSolver } from './practice-solver.js';
import { ModelServices } from './model-services.js';
async function main() {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const role = process.env.SOLVEFLOW_EXAM_ROLE ?? 'all';
    if (!['all', 'api', 'worker', 'events', 'migrate', 'bootstrap'].includes(role))
        throw new Error('INVALID_PROCESS_ROLE');
    const config = await loadExamConfig();
    const database = connectDatabase(config.databaseUrl);
    const storage = config.storage.type === 'local' ? new LocalExamStorage(config.storage.root) : new PrivateS3Storage(config.storage);
    sharp.concurrency(1);
    sharp.cache({ memory: 32, files: 0, items: 50 });
    let cleanup: (() => void) | undefined;
    let cache: Awaited<ReturnType<typeof connectCache>> | undefined;
    let practice: PracticeJobs | undefined;
    try {
        if (role === 'migrate') {
            await migrate(database.pool);
            console.info(JSON.stringify({ event: 'exam.migration.complete' }));
        }
        else if (role === 'bootstrap') {
            const existing = await database.pool.query(`SELECT u.id FROM exam_app.users u JOIN exam_app.user_roles ur ON ur.user_id=u.id JOIN exam_app.roles r ON r.id=ur.role_id WHERE r.code='admin' LIMIT 1`);
            if (!existing.rowCount) {
                if (!config.bootstrap)
                    throw new Error('PRIVATE_BOOTSTRAP_CREDENTIALS_REQUIRED');
                const admin = await bootstrap(database.pool, config.bootstrap.username, config.bootstrap.displayName, await hashPassword(config.bootstrap.password));
                if (!(await templates(database.pool)).length)
                    await createTemplate(database.pool, admin, buildCatalogTemplate({ code: 'sat-digital' }));
            }
            for (const category of ['solver', 'verifier'])
                await database.pool.query('INSERT INTO exam_app.execution_permits(role,slot_no) SELECT $1,n FROM generate_series(1,64) n ON CONFLICT DO NOTHING', [category]);
            console.info(JSON.stringify({ event: 'exam.bootstrap.complete' }));
        }
        else {
            const version = await database.pool.query('SELECT 1 FROM solveflow_migrations WHERE version=12');
            if (version.rowCount !== 1)
                throw new Error('EXAM_MIGRATION_REQUIRED');
            if (storage instanceof PrivateS3Storage)
                await storage.verifyPrivate();
            if (config.redisUrl)
                cache = await connectCache(config.redisUrl);
            const modelServices = config.modelSettingsKey ? new ModelServices(database.pool,config.modelSettingsKey,config.models,config.secondaryModels,config.allowedModelOrigins) : undefined;
            await modelServices?.initialize();
            const tasks: Promise<unknown>[] = [];
            if (role === 'all' || role === 'api') {
                if (config.liveCalls && (config.models || modelServices) && cache) {
                    const quota = cache;
                    practice = new PracticeJobs(practiceSolver(async request => {if(modelServices)return modelServices.resolve(request.modelService);if(!config.models)throw new Error('MODELS_REQUIRED');return config.models;}, userId => quota.claimPractice(userId, Math.min(100, config.dailyCallsPerStudent)),modelServices?.network),Date.now,4,modelServices ? owner=>modelServices.capture(owner) : undefined);
                }
                const service = createExamService({ pool: database.pool, storage, origin: config.origin, insecureHttpTrial: config.insecureHttpTrial, httpTrialAliases: config.httpTrialAliases, trustedProxyCidrs: config.trustedProxyCidrs, publicDir: resolve(dirname(fileURLToPath(import.meta.url)), 'public'), canSolve: () => config.liveCalls && (!!modelServices || !!config.models?.models.solver && !!config.models?.models.verifier),...(modelServices ? {modelServices} : {}), ...practice ? { practice } : {} });
                const port = Number(process.env.SOLVEFLOW_EXAM_PORT ?? 3190);
                if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
                    throw new Error('INVALID_PORT');
                const server = serve({ fetch: service.app.fetch, hostname: process.env.SOLVEFLOW_EXAM_HOST ?? '127.0.0.1', port });
                if (!(server instanceof Server))
                    throw new Error('HTTP_SERVER_REQUIRED');
                server.requestTimeout = 65000;
                server.headersTimeout = 10000;
                server.maxConnections = 256;
                server.maxHeadersCount = 60;
                const closeRealtime = realtime(server, database.pool, config.origin, async (cookie) => {
                    const session = await service.session(cookie);
                    if (cache)
                        void cache.presence(session.user.id).catch(() => { });
                    return session;
                }, config.httpTrialAliases);
                cleanup = () => { service.close(); closeRealtime(); server.closeAllConnections(); server.close(); };
                console.info(JSON.stringify({ event: 'exam.api.ready', port }));
                tasks.push(new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true })));
            }
            if (role === 'worker' || role === 'all' && config.liveCalls) {
                if (!config.liveCalls || !config.models && !modelServices)
                    throw new Error('LIVE_MODELS_NOT_ENABLED');
                tasks.push(workerLoop(database.pool, modelSolver(database.pool, storage, async job => {if(modelServices)return modelServices.resolve(job.modelService);if(!config.models)throw new Error('MODELS_REQUIRED');return config.models;}, { solver: config.solverConcurrency, verifier: config.verifierConcurrency, daily: config.dailyCallsPerStudent },modelServices?.network), controller.signal, Math.min(32, config.solverConcurrency + config.verifierConcurrency)));
            }
            if (role === 'events' || role === 'all')
                tasks.push((async () => {
                    let lastGc = 0;
                    while (!controller.signal.aborted) {
                        try { await expireExams(database.pool); }
                        catch { console.error(JSON.stringify({ event: 'exam.expiry.failed' })); }
                        if (Date.now() - lastGc > 60000) {
                            lastGc = Date.now();
                            try {
                                await collectGarbage(database.pool, storage);
                            }
                            catch {
                                console.error(JSON.stringify({ event: 'exam.maintenance.failed' }));
                            }
                        }
                        if (cache)
                            try {
                                await publishOutbox(database.pool, (id, seq) => cache?.publish(id, seq) ?? Promise.resolve(false));
                            }
                            catch {
                                console.error(JSON.stringify({ event: 'exam.outbox.unavailable' }));
                            }
                        await delay(1000, undefined, { signal: controller.signal }).catch(() => { });
                    }
                })());
            await Promise.all(tasks);
        }
    }
    catch {
        process.exitCode = 1;
        console.error(JSON.stringify({ event: 'exam.process.failed', role, code: 'CHECK_PRIVATE_CONFIG_AND_INFRASTRUCTURE' }));
    }
    finally {
        controller.abort();
        cleanup?.();
        practice?.close();
        cache?.close();
        storage.close();
        await database.close();
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}
void main().catch(() => { process.exitCode = 1; console.error(JSON.stringify({ event: "exam.start.failed", code: "CHECK_PRIVATE_CONFIGURATION" })); });
