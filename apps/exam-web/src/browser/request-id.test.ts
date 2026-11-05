import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { newRequestId } from './request-id.js';

afterEach(() => vi.unstubAllGlobals());

it('uses the native UUID generator when available', () => {
    const randomUUID=vi.fn(()=> '00000000-0000-4000-8000-000000000001');
    vi.stubGlobal('crypto',{ randomUUID });
    expect(newRequestId()).toBe('00000000-0000-4000-8000-000000000001');
    expect(randomUUID).toHaveBeenCalledOnce();
});

it('uses cryptographic randomness with UUID v4 version and variant in an HTTP context', () => {
    vi.stubGlobal('crypto',{ getRandomValues:(bytes:Uint8Array)=>bytes.fill(255) });
    expect(newRequestId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    vi.stubGlobal('crypto',{ getRandomValues:webcrypto.getRandomValues.bind(webcrypto) });
    const ids=Array.from({length:1000},()=>newRequestId());
    expect(new Set(ids).size).toBe(1000);
    expect(ids.every(value=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))).toBe(true);
});

it('fails clearly if secure random numbers are unavailable', () => {
    vi.stubGlobal('crypto',undefined);
    expect(()=>newRequestId()).toThrow('浏览器不支持安全随机数');
});
