// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-review-hardening.md
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExamAttemptSchema, ExamWsServerSchema, type ExamAttempt } from '@solveflow/contracts/managed-exam';
import { api } from './api.js';
export function useAttempt(id: string) {
    const [attempt, setAttempt] = useState<ExamAttempt | null>(null), [error, setError] = useState(''), [online, setOnline] = useState(false);
    const current = useRef<ExamAttempt | null>(null);
    const refresh = useCallback(async (signal?: AbortSignal) => { try {
        const next = await api('/attempts/' + id + '/snapshot', ExamAttemptSchema, signal ? { signal } : {});
        if (current.current && next.lastSeq < current.current.lastSeq)
            return current.current;
        if (!signal?.aborted) {
            current.current = next;
            setAttempt(next);
            setError('');
        }
        return next;
    }
    catch (error) {
        if (!signal?.aborted)
            setError(error instanceof Error ? error.message : '同步失败。');
        return null;
    } }, [id]);
    useEffect(() => {
        const controller = new AbortController();
        let ws: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, alive = true, failures = 0, pollBusy = false, syncPending = false, lastBeat = 0, lastRefresh = 0;
        current.current = null;
        setAttempt(null);
        const sync = () => {
            if (controller.signal.aborted) return;
            syncPending = true;
            if (pollBusy) return;
            pollBusy = true;
            void (async () => {
                do {
                    syncPending = false;
                    await refresh(controller.signal);
                    lastRefresh = Date.now();
                } while (syncPending && !controller.signal.aborted);
            })().finally(() => { pollBusy = false; });
        };
        sync();
        const connect = () => { if (!alive)
            return; ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); ws.onopen = () => { failures = 0; lastBeat = Date.now(); setOnline(true); ws?.send(JSON.stringify({ type: 'subscribe', attemptId: id, afterSeq: current.current?.lastSeq ?? 0 })); sync(); }; ws.onmessage = event => { let raw: unknown; try {
            raw = JSON.parse(String(event.data));
        }
        catch {
            return;
        } const parsed = ExamWsServerSchema.safeParse(raw); if (!parsed.success)
            return; lastBeat = Date.now(); if (parsed.data.type === 'changed' && parsed.data.attemptId === id && parsed.data.lastSeq !== (current.current?.lastSeq ?? 0))
            sync(); }; ws.onerror = () => ws?.close(); ws.onclose = () => { if (!alive)
            return; setOnline(false); retry = setTimeout(connect, Math.min(15000, 500 * 2 ** Math.min(failures++, 5))); }; };
        connect();
        const timer = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) {
            if (Date.now() - lastBeat > 45000) {
                ws.close();
                return;
            }
            ws.send(JSON.stringify({ type: 'heartbeat' }));
            if (Date.now() - lastRefresh > 15000)
                sync();
        }
        else
            sync(); }, 5000);
        const foreground = () => { if (document.visibilityState === 'visible')
            sync(); };
        document.addEventListener('visibilitychange', foreground);
        window.addEventListener('online', sync);
        return () => { alive = false; controller.abort(); clearInterval(timer); clearTimeout(retry); ws?.close(); setOnline(false); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('online', sync); };
    }, [id, refresh]);
    return { attempt, error, online, refresh };
}
