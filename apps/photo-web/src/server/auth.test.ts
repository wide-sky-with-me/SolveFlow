import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PhotoAuth, LoginThrottle } from './auth.js';
import { PhotoLedger } from './ledger.js';
const key = 'synthetic-access-key-for-test-only';
const keys = [{ id: 'test-account', hash: createHash('sha256').update(key).digest('hex') }];
describe('public photo access', () => {
  it('uses signed HttpOnly cookies, rejects tampering, expiry and process-restart replay', () => {
    let now = 100000; const auth = new PhotoAuth(keys, 'synthetic-test-secret-'.repeat(3), true, () => now);
    expect(auth.login('wrong')).toBeNull(); const login = auth.login(key)!;
    expect(login.cookie).toContain('HttpOnly; SameSite=Strict'); expect(login.cookie).toContain('Secure');
    expect(auth.session(login.cookie)?.id).toBe(keys[0]!.id);
    expect(auth.session(login.cookie.replace('=', '=tampered'))).toBeNull();
    expect(new PhotoAuth(keys, 'synthetic-test-secret-'.repeat(3), true, () => now).session(login.cookie)).toBeNull();
    now += 8 * 24 * 60 * 60 * 1000; expect(auth.session(login.cookie)).toBeNull();
  });
  it('limits failed logins and expires the bucket', () => {
    let now = 100; const throttle = new LoginThrottle(() => now);
    for (let n=0;n<8;n++) throttle.fail('test-client'); expect(throttle.blocked('test-client')).toBe(true);
    expect(throttle.blocked('other')).toBe(false); now += 16 * 60000; expect(throttle.blocked('test-client')).toBe(false);
  });
  it('expires a full login table without requiring an admitted request', () => {
    let now = 100;
    const throttle = new LoginThrottle(() => now);
    for (let n = 0; n < 2048; n++) throttle.fail('test-client-' + n);
    expect(throttle.full).toBe(true);
    now += 16 * 60000;
    expect(throttle.full).toBe(false);
  });
  it('persists request claims, isolates accounts, bounds usage and fails closed on corrupt storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'photo-ledger-')); const path = join(dir, 'ledger.json'); const id = 'c7f4a17e-6d42-4cd3-a726-42ffef8f4737';
    try {
      await new PhotoLedger(path, 1).claim('first', id);
      await expect(new PhotoLedger(path, 1).claim('first', id)).rejects.toThrow('已提交');
      await new PhotoLedger(path, 1).claim('second', id);
      await expect(new PhotoLedger(path, 1).claim('first', '49e19de0-37bb-4dc0-8227-ee3467e66ba0')).rejects.toThrow('上限');
      await writeFile(path, 'corrupt'); await expect(new PhotoLedger(path).claim('other', id)).rejects.toThrow('额度记录');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
