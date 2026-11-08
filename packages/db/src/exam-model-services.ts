// Decision: .agents/notes/implemented/architecture/2026-11-06-managed-model-services.md
import type pg from 'pg';
import { z } from 'zod';
import { ExamModelServiceCodeSchema, ExamModelServiceRefSchema, type ExamModelServiceCode, type ExamModelServiceRef } from '@solveflow/contracts/exam-model-services';
import type { ExamUser } from '@solveflow/contracts/managed-exam';
import { audit, conflict, forbidden, isAdmin, lockActor, one, rows, tx, type Queryable } from './exam-store.js';

export const storedModelServiceSchema = z.strictObject({ code: ExamModelServiceCodeSchema, version: z.number().int().positive(), name: z.string(), enabled: z.boolean(), ciphertext: z.string().nullable() });
export type StoredModelService = z.infer<typeof storedModelServiceSchema>;
const versionJson = "jsonb_build_object('code',v.code,'version',v.version,'name',v.name,'enabled',v.enabled,'ciphertext',v.ciphertext)";
export async function modelServiceVersions(db: Queryable) {
    return rows(db, storedModelServiceSchema, `SELECT ${versionJson} AS value FROM exam_app.model_services h JOIN exam_app.model_service_versions v ON v.code=h.code AND v.version=h.current_version ORDER BY h.code DESC`);
}
export async function modelServiceVersion(db: Queryable, ref: ExamModelServiceRef) {
    return one(db, storedModelServiceSchema, `SELECT ${versionJson} AS value FROM exam_app.model_service_versions v WHERE v.code=$1 AND v.version=$2`, [ref.code, ref.version]);
}
export async function initializeModelServices(pool: pg.Pool, seeds: StoredModelService[]) {
    await tx(pool, async c => {
        await c.query('SELECT pg_advisory_xact_lock(5839201008)');
        for (const seed of seeds) {
            if ((await c.query('SELECT 1 FROM exam_app.model_services WHERE code=$1', [seed.code])).rowCount) continue;
            await c.query('INSERT INTO exam_app.model_service_versions(code,version,name,enabled,ciphertext) VALUES($1,1,$2,$3,$4)', [seed.code, seed.name, seed.enabled, seed.ciphertext]);
            await c.query('INSERT INTO exam_app.model_services(code,current_version) VALUES($1,1)', [seed.code]);
        }
    });
}
export async function saveModelService(pool: pg.Pool, actor: ExamUser, expectedVersion: number, next: StoredModelService) {
    if (!isAdmin(actor)) throw forbidden();
    return tx(pool, async c => {
        await lockActor(c, actor);
        const version = await one(c, z.number(), 'SELECT current_version AS value FROM exam_app.model_services WHERE code=$1 FOR UPDATE', [next.code]);
        if (version !== expectedVersion || next.version !== version + 1) throw conflict('服务配置已更新，请重新读取后保存。');
        await c.query('INSERT INTO exam_app.model_service_versions(code,version,name,enabled,ciphertext,created_by) VALUES($1,$2,$3,$4,$5,$6)', [next.code,next.version,next.name,next.enabled,next.ciphertext,actor.id]);
        await c.query('UPDATE exam_app.model_services SET current_version=$2 WHERE code=$1', [next.code,next.version]);
        await audit(c, actor.id, 'model-service.update', actor.id, 'model-service:' + next.code);
        return next;
    });
}
export async function userModelService(db: Queryable, userId: string) {
    return one(db, z.strictObject({ code: ExamModelServiceCodeSchema, version: z.number().int().nonnegative() }), `SELECT jsonb_build_object('code',coalesce(p.code,'primary'),'version',coalesce(p.version,0)) AS value FROM exam_app.users u LEFT JOIN exam_app.user_model_services p ON p.user_id=u.id WHERE u.id=$1`, [userId]);
}
export async function selectModelService(pool: pg.Pool, actor: ExamUser, code: ExamModelServiceCode, expectedVersion: number) {
    if (actor.state !== 'active' || !actor.roles.includes('student')) throw forbidden();
    return tx(pool, async c => {
        await lockActor(c, actor);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['model-choice:' + actor.id]);
        const current = await userModelService(c, actor.id);
        const available = await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.model_services h JOIN exam_app.model_service_versions v ON v.code=h.code AND v.version=h.current_version WHERE h.code=$1 AND v.enabled AND v.ciphertext IS NOT NULL) AS value`, [code]);
        if (!available) throw conflict('所选服务暂不可用，请选择其他服务。');
        // Repeating an already applied choice after an uncertain response is harmless.
        if (current.version !== expectedVersion) { if (current.code === code) return current; throw conflict('服务选择已在其他页面更新，请重新读取。'); }
        if (current.code === code) return current;
        await c.query('INSERT INTO exam_app.user_model_services(user_id,code,version) VALUES($1,$2,1) ON CONFLICT(user_id) DO UPDATE SET code=excluded.code,version=exam_app.user_model_services.version+1,updated_at=now()', [actor.id,code]);
        await audit(c, actor.id, 'model-service.select', actor.id, 'user');
        return userModelService(c, actor.id);
    });
}
export async function preferredModelService(db: Queryable, userId: string): Promise<ExamModelServiceRef | null> {
    const choice = await userModelService(db, userId);
    const configured = (await rows(db, storedModelServiceSchema, `SELECT ${versionJson} AS value FROM exam_app.model_services h JOIN exam_app.model_service_versions v ON v.code=h.code AND v.version=h.current_version WHERE h.code=$1`, [choice.code]))[0];
    if (!configured) { if (choice.code === 'primary') return null; throw conflict('所选服务暂不可用，请选择其他服务。'); }
    if (!configured.enabled || !configured.ciphertext) throw conflict('所选服务暂不可用，请选择其他服务。');
    return ExamModelServiceRefSchema.parse({code:configured.code,version:configured.version});
}
/** Pin at enqueue, before later profile edits or a student's account-menu change. */
export async function pinRunModelService(c: Queryable, runId: string, studentId: string) {
    const ref = await preferredModelService(c, studentId);
    if (ref) await c.query('UPDATE exam_app.answer_runs SET model_service_code=$2,model_service_version=$3 WHERE id=$1', [runId,ref.code,ref.version]);
}
