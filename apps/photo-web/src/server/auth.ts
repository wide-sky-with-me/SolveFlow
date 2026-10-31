import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const AccessKeysSchema = z.array(z.strictObject({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), hash: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(20)
  .refine(keys => new Set(keys.map(k => k.id)).size === keys.length && new Set(keys.map(k => k.hash)).size === keys.length);
type AccessKeys = z.infer<typeof AccessKeysSchema>;
const SessionSchema = z.strictObject({ id: z.string(), nonce: z.string().regex(/^[0-9a-f]{32}$/), expires: z.number().int(), issued: z.number().int() });
const TTL = 7 * 24 * 60 * 60 * 1000;
export class PhotoAuth {
  readonly cookieName: string;
  private readonly bootId = randomBytes(16).toString('hex');
  constructor(private readonly keys: AccessKeys, private readonly secret: string, private readonly secure: boolean, private readonly now = Date.now) {
    this.cookieName = secure ? '__Host-solveflow-photo' : 'solveflow-photo-test';
  }
  login(key: string) {
    const digest = createHash('sha256').update(key).digest();
    const matched = this.keys.find(k => timingSafeEqual(Buffer.from(k.hash, 'hex'), digest));
    if (!matched) return null;
    const issued = this.now(); const session = { id: matched.id, nonce: randomBytes(16).toString('hex'), issued, expires: issued + TTL };
    const body = Buffer.from(JSON.stringify(session)).toString('base64url');
    return { session, cookie: this.cookie(`${body}.${this.signature(body)}`, TTL / 1000) };
  }
  session(header: string | undefined) {
    const token = header?.split(';').map(p => p.trim()).find(p => p.startsWith(this.cookieName + '='))?.slice(this.cookieName.length + 1);
    if (!token || token.length > 700) return null;
    const parts = token.split('.'); const body = parts[0], signature = parts[1];
    if (parts.length !== 2 || !body || !signature || !/^[a-zA-Z0-9_-]+$/.test(signature)) return null;
    const expected = Buffer.from(this.signature(body)); const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    try {
      const parsed = SessionSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString()));
      if (parsed.expires <= this.now() || parsed.issued > this.now() + 60000 || parsed.expires - parsed.issued !== TTL || !this.keys.some(k => k.id === parsed.id)) return null;
      return parsed;
    } catch { return null; }
  }
  clearCookie() { return this.cookie('', 0); }
  private signature(body: string) { return createHmac('sha256', this.secret).update(this.bootId + ':' + body).digest('base64url'); }
  private cookie(value: string, maxAge: number) { return `${this.cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secure ? '; Secure' : ''}`; }
}

/** Bounded failed-login buckets. Remote address comes from the actual socket, not forwarded headers. */
export class LoginThrottle {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly now = Date.now) {}
  blocked(address: string) {
    for (const [key, value] of this.attempts) if (value.until <= this.now()) this.attempts.delete(key);
    return (this.attempts.get(address)?.count ?? 0) >= 8;
  }
  fail(address: string) {
    const existing = this.attempts.get(address);
    if (!existing && this.attempts.size >= 2048) return;
    this.attempts.set(address, { count: (existing?.count ?? 0) + 1, until: existing?.until ?? this.now() + 15 * 60000 });
  }
  get full() {
    for (const [key, value] of this.attempts) if (value.until <= this.now()) this.attempts.delete(key);
    return this.attempts.size >= 2048;
  }
}
