import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
const LedgerSchema = z.strictObject({ schemaVersion: z.literal(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), claims: z.array(z.strictObject({ account: z.string().max(64), id: z.uuid() })).max(2000) });
/** A durable claim is written before paid work; restart never admits the same daily request twice. */
export class PhotoLedger {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly dailyLimit = 100, private readonly now = () => new Date()) {}
  claim(account: string, id: string): Promise<void> {
    const work = this.serial.then(async () => {
      const day = this.now().toISOString().slice(0, 10); let state: z.infer<typeof LedgerSchema>;
      try { state = LedgerSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('额度记录暂不可用，请稍后重试。'); state = { schemaVersion: 1, day, claims: [] }; }
      if (state.day !== day) state = { schemaVersion: 1, day, claims: [] };
      if (state.claims.some(c => c.account === account && c.id === id)) throw new Error('本次请求已提交，请查看历史记录。');
      if (state.claims.length >= 2000 || state.claims.filter(c => c.account === account).length >= this.dailyLimit) throw new Error('今日使用次数已达上限。');
      state.claims.push({ account, id });
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = this.file + '.pending'; const file = await open(temporary, 'w', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.file);
    });
    this.serial = work.catch(() => undefined); return work;
  }
}
