// Decision: .agents/notes/implemented/architecture/2026-11-02-managed-exam-foundation.md
import type { Server } from 'node:http';
import { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from 'redis';
import type { Pool } from 'pg';
import type { ExamSessionSchema } from '@solveflow/contracts/managed-exam';
import { ExamWsClientSchema } from '@solveflow/contracts/managed-exam';
import { attemptSequence, rows } from '@solveflow/db';
import { z } from 'zod';
type Session = z.infer<typeof ExamSessionSchema>;
export function realtime(server: Server, pool: Pool, origin: string, authenticate: (cookie: string | undefined) => Promise<Session>, aliases: readonly string[] = [], subscribe?: (onAttempt: (attemptId: string) => void) => () => void) {
    const allowedOrigins = new Set([origin, ...aliases]);
    const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
    const watchers = new Set<{ attemptId: () => string | null; check: () => void }>();
    let closed = false;
    const unsubscribe = subscribe?.(changedId => {
        if (closed) return;
        for (const watcher of watchers) if (watcher.attemptId() === changedId) watcher.check();
    });
    server.on('upgrade', (request, socket, head) => { if (!(socket instanceof Socket)) {
        socket.destroy();
        return;
    } if (closed || request.url !== '/ws' || !allowedOrigins.has(request.headers.origin ?? '') || wss.clients.size >= 128) {
        socket.destroy();
        return;
    } socket.setTimeout(5000, () => socket.destroy()); void authenticate(request.headers.cookie).then(() => { if (!socket.destroyed)
        wss.handleUpgrade(request, socket, head, ws => { socket.setTimeout(0); wss.emit('connection', ws, request); }); }).catch(() => socket.destroy()); });
    wss.on('connection', (ws, request) => {
        let attemptId: string | null = null, lastSeq = -1, lastBeat = Date.now(), busy = false, dirty = false;
        let messages = 0, windowStart = Date.now();
        const send = (value: unknown) => { if (ws.readyState === WebSocket.OPEN) {
            if (ws.bufferedAmount > 65536) {
                ws.close(1013);
                return;
            }
            ws.send(JSON.stringify(value));
        } };
        const check = () => {
            if (closed || ws.readyState !== WebSocket.OPEN || !attemptId) return;
            if (busy) { dirty = true; return; }
            busy = true;
            const target = attemptId;
            void authenticate(request.headers.cookie).then(async (session) => {
                const seq = await attemptSequence(pool, session.user, target);
                if (attemptId === target && seq !== lastSeq) {
                    send({ type: 'changed', attemptId: target, lastSeq: seq });
                    lastSeq = seq;
                }
            }).catch(() => ws.close(1008)).finally(() => {
                busy = false;
                if (dirty && !closed && ws.readyState === WebSocket.OPEN) {
                    dirty = false;
                    check();
                }
            });
        };
        const watcher = { attemptId: () => attemptId, check };
        watchers.add(watcher);
        ws.on('error', () => ws.close());
        ws.on('message', data => {
            if (Date.now() - windowStart > 60000) {
                windowStart = Date.now();
                messages = 0;
            }
            if (++messages > 30) {
                ws.close(1008);
                return;
            }
            let raw: unknown;
            try {
                raw = JSON.parse(data.toString());
            }
            catch {
                ws.close(1008);
                return;
            }
            const parsed = ExamWsClientSchema.safeParse(raw);
            if (!parsed.success) {
                ws.close(1008);
                return;
            }
            lastBeat = Date.now();
            if (parsed.data.type === 'heartbeat') {
                send({ type: 'heartbeat' });
                return;
            }
            const target = parsed.data;
            void authenticate(request.headers.cookie).then(async (session) => {
                const seq = await attemptSequence(pool, session.user, target.attemptId);
                attemptId = target.attemptId;
                lastSeq = target.afterSeq;
                if (seq !== lastSeq) {
                    send({ type: 'changed', attemptId: target.attemptId, lastSeq: seq });
                    lastSeq = seq;
                }
            }).catch(() => ws.close(1008));
        });
        const timer = setInterval(() => { if (Date.now() - lastBeat > 45000) {
            ws.close(1001);
            return;
        } check(); }, 1000);
        ws.on('close', () => { watchers.delete(watcher); clearInterval(timer); });
    });
    return () => { closed = true; unsubscribe?.(); watchers.clear(); for (const client of wss.clients)
        client.terminate(); wss.close(); };
}
/** Redis holds presence, notifications and content-free practice quotas; PG owns exams. */
export async function connectCache(url: string) {
    const options = { url, disableOfflineQueue: true, commandsQueueMaxLength: 128, socket: { connectTimeout: 2000, reconnectStrategy: (retries: number) => Math.min(5000, 200 * 2 ** Math.min(retries, 5)) } };
    const client = createClient(options);
    let lastError = 0;
    const onError = () => { if (Date.now() - lastError > 60000) {
        lastError = Date.now();
        console.error(JSON.stringify({ event: 'exam.cache.unavailable' }));
    } };
    client.on('error', onError);
    void client.connect().catch(() => { });
    const subscribers = new Set<() => void>();
    const changeNotice = z.object({ attemptId: z.uuid() });
    return { async presence(userId: string) { if (client.isReady)
            await client.withCommandOptions({ timeout: 2000 }).set('exam:presence:' + userId, '1', { EX: 45 }); }, async publish(attemptId: string, seq: number) { if (!client.isReady)
            return false; await client.withCommandOptions({ timeout: 2000 }).publish('exam:changes', JSON.stringify({ attemptId, seq })); return true; },
        subscribe(onAttempt: (attemptId: string) => void) {
            const sub = createClient({ ...options, disableOfflineQueue: false });
            sub.on('error', onError);
            let stopped = false;
            const stop = () => { stopped = true; subscribers.delete(stop); if (sub.isOpen) sub.destroy(); };
            subscribers.add(stop);
            void sub.connect().then(() => {
                if (stopped) { sub.destroy(); return; }
                return sub.subscribe('exam:changes', message => {
                    if (stopped) return;
                    try {
                        const parsed = changeNotice.safeParse(JSON.parse(message));
                        if (parsed.success) onAttempt(parsed.data.attemptId);
                    } catch { /* Ignore malformed pub/sub message. */ }
                });
            }).catch(() => { });
            return stop;
        },
        async claimPractice(userId: string, limit: number) {
            if (!client.isReady) throw new Error('PRACTICE_QUOTA_UNAVAILABLE');
            // Counters contain no photos or answer content; quota failures stop dispatch.
            const key = 'exam:practice:calls:' + new Date().toISOString().slice(0, 10) + ':' + userId;
            const count = await client.withCommandOptions({ timeout: 2000 }).eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],172800) end;return n", { keys: [key], arguments: [] });
            if (typeof count !== 'number' || count > limit) throw new Error('PRACTICE_DAILY_LIMIT');
        }, close() { for (const stop of [...subscribers]) stop(); subscribers.clear(); if (client.isOpen)
            client.destroy(); } };
}
export async function publishOutbox(pool: Pool, publish: (attemptId: string, seq: number) => Promise<boolean>) {
    const batch = await rows(pool, z.object({ id: z.uuid(), seq: z.coerce.number() }), `SELECT jsonb_build_object('id',attempt_id,'seq',seq) AS value FROM exam_app.attempt_events WHERE published_at IS NULL ORDER BY created_at LIMIT 100`);
    for (const item of batch) {
        if (!await publish(item.id, item.seq))
            break;
        await pool.query('UPDATE exam_app.attempt_events SET published_at=now(),publish_attempts=publish_attempts+1 WHERE attempt_id=$1 AND seq=$2 AND published_at IS NULL', [item.id, item.seq]);
    }
    return batch.length;
}
