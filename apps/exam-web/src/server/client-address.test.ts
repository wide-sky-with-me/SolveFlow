import { describe, expect, it } from 'vitest';
import { clientAddressResolver, TrustedProxyCidrSchema } from './client-address.js';
import { ExamConfigSchema } from './config.js';

describe('managed exam trusted proxy boundary', () => {
    it('ignores forwarding headers from a direct or untrusted connection', () => {
        expect(clientAddressResolver()('127.0.0.1', '203.0.113.1')).toBe('127.0.0.1');
        expect(clientAddressResolver(['172.18.0.0/16'])('198.51.100.1', '203.0.113.1')).toBe('198.51.100.1');
    });
    it('uses the nearest untrusted hop instead of a spoofed leftmost address', () => {
        const resolve = clientAddressResolver(['172.18.0.0/16']);
        expect(resolve('172.18.0.2', '192.0.2.9, 203.0.113.1')).toBe('203.0.113.1');
        expect(resolve('172.18.0.2', '203.0.113.1, 172.18.0.3')).toBe('203.0.113.1');
        expect(resolve('::ffff:172.18.0.2', '203.0.113.1')).toBe('203.0.113.1');
        expect(clientAddressResolver(['::1/128'])('::1', '2001:db8::7')).toBe('2001:db8::7');
    });
    it('rejects malformed or excessive chains without creating attacker-controlled buckets', () => {
        const resolve = clientAddressResolver(['127.0.0.1/32']);
        for (const value of ['garbage', '203.0.113.1,', '203.0.113.1:80', Array(17).fill('203.0.113.1').join(','), 'a'.repeat(1025)])
            expect(resolve('127.0.0.1', value)).toBe('127.0.0.1');
    });
    it('validates operator allowlists and keeps old direct-connection configs compatible', () => {
        for (const value of ['0.0.0.0/-1', '127.0.0.0/33', '::1/129', 'localhost/8', '127.0.0.1/8/2'])
            expect(TrustedProxyCidrSchema.safeParse(value).success).toBe(false);
        const parsed = ExamConfigSchema.parse({ schemaVersion: 1, origin: 'http://127.0.0.1:3190', databaseUrl: 'postgresql://localhost/exam', storage: { type: 'local', root: '/tmp/exam-test' } });
        expect(parsed.trustedProxyCidrs).toEqual([]);
    });
});
