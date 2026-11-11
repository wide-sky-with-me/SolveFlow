// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-review-hardening.md
// Decision: .agents/notes/implemented/architecture/2026-11-09-browser-sync-continuity.md
import { useCallback, useEffect, useRef, useState } from 'react';
import { EXAM_ANSWER_VALUES_HEADER, ExamAttemptSchema, ExamWsServerSchema, type ExamAttempt } from '@solveflow/contracts/managed-exam';
import { api } from './api.js';
export function useAttempt(id: string) {
    const [attempt, setAttempt] = useState<ExamAttempt | null>(null), [error, setError] = useState(''), [online, setOnline] = useState(false);
    const syncOwner = useRef<{id: string; refresh: () => Promise<ExamAttempt | null>} | null>(null);
    const refresh = useCallback(() => syncOwner.current?.id === id ? syncOwner.current.refresh() : Promise.resolve(null), [id]);
    useEffect(() => {
        const controller = new AbortController();
        let ws: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, failures = 0, lastBeat = 0, lastRefresh = 0, connectedOnce = false;
        type Read = Promise<ExamAttempt | null>;
        let current: ExamAttempt | null = null, inFlight: Read | null = null, afterWrite: {read: Read; promise: Read} | null = null, notifiedSeq = 0;
        setAttempt(null);
        setError('');
        setOnline(false);
        const sync = (fresh = false): Promise<ExamAttempt | null> => {
            if (controller.signal.aborted) return Promise.resolve(null);
            if (inFlight) {
                // A write may commit after the pending read took its snapshot.
                if (!fresh) return inFlight;
                if (afterWrite?.read === inFlight) return afterWrite.promise;
                const queued = {read: inFlight, promise: Promise.resolve<ExamAttempt | null>(null)};
                queued.promise = inFlight.then(() => sync()).finally(() => { if (afterWrite === queued) afterWrite = null; });
                afterWrite = queued;
                return queued.promise;
            }
            notifiedSeq = 0;
            let succeeded = false;
            inFlight = (async () => {
                try {
                    const next = await api('/attempts/' + id + '/snapshot', ExamAttemptSchema, {headers:{[EXAM_ANSWER_VALUES_HEADER]:'1'},signal:controller.signal});
                    if (controller.signal.aborted) return null;
                    if (!current || next.lastSeq >= current.lastSeq) {
                        current = next;
                        setAttempt(next);
                    }
                    succeeded = true;
                    setError('');
                    return current;
                } catch (error) {
                    if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '同步失败。');
                    return null;
                }
            })().finally(() => {
                inFlight = null;
                lastRefresh = Date.now();
                // Drain only uncovered events. Each caller settles after its own read,
                // so a continuous event stream cannot keep a saved form disabled.
                if (succeeded && document.visibilityState === 'visible' && notifiedSeq > (current?.lastSeq ?? 0)) void sync();
            });
            return inFlight;
        };
        const owner = {id, refresh: () => sync(true)};
        syncOwner.current = owner;
        const visibleSync = () => { if (document.visibilityState === 'visible') void sync(); };
        void sync();
        const connect = () => {
            if (controller.signal.aborted) return;
            const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
            ws = socket;
            const active = () => !controller.signal.aborted && ws === socket;
            socket.onopen = () => {
                if (!active()) return;
                failures = 0; lastBeat = Date.now(); setOnline(true);
                socket.send(JSON.stringify({type: 'subscribe', attemptId: id, afterSeq: current?.lastSeq ?? 0}));
                // The first snapshot and subscription cover initial entry; reconnects resync.
                if (connectedOnce) visibleSync();
                connectedOnce = true;
            };
            socket.onmessage = event => {
                if (!active()) return;
                let raw: unknown;
                try { raw = JSON.parse(String(event.data)); } catch { return; }
                const parsed = ExamWsServerSchema.safeParse(raw);
                if (!parsed.success) return;
                lastBeat = Date.now();
                if (parsed.data.type === 'changed' && parsed.data.attemptId === id && parsed.data.lastSeq > (current?.lastSeq ?? 0)) {
                    notifiedSeq = Math.max(notifiedSeq, parsed.data.lastSeq);
                    visibleSync();
                }
            };
            socket.onerror = () => socket.close();
            socket.onclose = () => {
                if (!active()) return;
                setOnline(false);
                retry = setTimeout(connect, Math.min(15000, 500 * 2 ** Math.min(failures++, 5)));
            };
        };
        connect();
        const timer = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) {
            if (Date.now() - lastBeat > 45000) {
                ws.close();
                return;
            }
            ws.send(JSON.stringify({ type: 'heartbeat' }));
            if (Date.now() - lastRefresh > 15000)
                visibleSync();
        }
        else
            visibleSync(); }, 5000);
        document.addEventListener('visibilitychange', visibleSync);
        window.addEventListener('online', visibleSync);
        return () => { controller.abort(); if (syncOwner.current === owner) syncOwner.current = null; clearInterval(timer); clearTimeout(retry); ws?.close(); document.removeEventListener('visibilitychange', visibleSync); window.removeEventListener('online', visibleSync); };
    }, [id]);
    return { attempt, error, online, refresh };
}
