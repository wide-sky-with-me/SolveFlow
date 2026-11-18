import { describe, expect, it } from 'vitest';
import { createWakeup } from './worker.js';

describe('createWakeup', () => {
    it('wakes waiting workers immediately and consumes pre-arrival notifications once without busy-spinning', async () => {
        const wakeup = createWakeup();
        const signal = new AbortController().signal;

        const started = performance.now();
        setTimeout(() => wakeup.notify(), 10);
        await wakeup.wait(5000, signal);
        expect(performance.now() - started).toBeLessThan(500);

        // A notification arriving while workers are between claimJob() and wait() is consumed once.
        wakeup.notify();
        const preNotified = performance.now();
        await wakeup.wait(5000, signal);
        expect(performance.now() - preNotified).toBeLessThan(100);

        // Next wait without a new notification honors the fallback timeout.
        const fallback = performance.now();
        await wakeup.wait(25, signal);
        expect(performance.now() - fallback).toBeGreaterThanOrEqual(18);
    });

    it('rejects promptly on abort without retaining listeners', async () => {
        const wakeup = createWakeup();
        const controller = new AbortController();
        const pending = wakeup.wait(5000, controller.signal);
        controller.abort(new Error('STOP'));
        await expect(pending).rejects.toThrow('STOP');
    });
});
