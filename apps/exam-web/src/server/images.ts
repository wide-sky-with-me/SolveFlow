// Decision: .agents/notes/implemented/architecture/2026-11-09-managed-backend-performance.md
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { assignmentAccessSql, audit, attemptAssignment, conflict, forbidden, hash, isAdmin, one, rows, scope, tx } from '@solveflow/db';
import { EXAM_SOURCE_IMAGE_BYTES, EXAM_MODEL_IMAGE_BYTES, type ExamUser, type ExamMediaView } from '@solveflow/contracts/managed-exam';
import type { NormalizedImage, SolverInput } from '@solveflow/contracts/agent';
import type { ExamStorage } from './storage.js';
export async function normalizeImages(raw: Uint8Array) {
    if (!raw.length || raw.length > EXAM_SOURCE_IMAGE_BYTES)
        throw conflict('请选择10MiB以内的题图。');
    const metadata = await sharp(raw, { limitInputPixels: 20000000, failOn: 'warning' }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
        throw conflict('请选择JPEG、PNG或WebP图片。');
    const source = await sharp(raw, { limitInputPixels: 20000000, failOn: 'warning' }).rotate().flatten({ background: '#fff' }).jpeg({ quality: 96 }).toBuffer({ resolveWithObject: true });
    const model = await sharp(source.data).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(source.data).resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer({ resolveWithObject: true });
    if (source.data.length > EXAM_SOURCE_IMAGE_BYTES || model.data.length > EXAM_MODEL_IMAGE_BYTES)
        throw conflict('图片处理后仍过大，请缩小或重拍。');
    return { source, model, thumbnail };
}
export async function upload(pool: Pool, storage: ExamStorage, actor: ExamUser, slotId: string, requestId: string, raw: Uint8Array) {
    const attemptId = await one(pool, z.uuid(), 'SELECT attempt_id AS value FROM exam_app.question_slots WHERE id=$1', [slotId]);
    await scope(pool, actor, await attemptAssignment(pool, attemptId), true);
    const allowed = await one(pool, z.boolean(), `SELECT a.state IN ('assigned','completed') AND s.state='published' AND now()>=a.opens_at AND (a.closes_at IS NULL OR now()<a.closes_at) AND x.state IN ('in_progress','completed') AND x.ended_at IS NULL AS value FROM exam_app.question_slots q JOIN exam_app.exam_attempts x ON x.id=q.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE q.id=$1`, [slotId]);
    if (!allowed)
        throw conflict('当前题位不可上传。');
    const images = await normalizeImages(raw);
    const inputHash = hash(raw);
    const reservation = await tx(pool, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['media-quota:' + actor.id]);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['upload:' + actor.id + ':' + requestId]);
        const old = await rows(c, z.object({ id: z.uuid(), hash: z.string(), state: z.string(), slotId: z.uuid() }), `SELECT jsonb_build_object('id',i.asset_id,'hash',i.input_sha256,'state',i.state,'slotId',i.slot_id) AS value FROM exam_app.upload_intents i WHERE student_id=$1 AND client_request_id=$2`, [actor.id, requestId]);
        if (old[0]) {
            if (old[0].hash !== inputHash || old[0].slotId !== slotId)
                throw conflict('上传标识已被其他内容使用。');
            if (['validated', 'consumed'].includes(old[0].state))
                return { existing: old[0].id, assets: [] };
            throw conflict('图片正在上传或已失效，请重试选择。');
        }
        const used = await one(c, z.coerce.number(), "SELECT coalesce(sum(byte_size),0) AS value FROM exam_app.media_assets WHERE owner_user_id=$1 AND state IN ('quarantined','ready','deleting')", [actor.id]);
        if (used + Object.values(images).reduce((n, v) => n + v.data.length, 0) > 1024 * 1024 * 1024)
            throw conflict('图片存储已达上限，请联系管理员。');
        const daily = await one(c, z.coerce.number(), "SELECT count(*) AS value FROM exam_app.upload_intents WHERE student_id=$1 AND created_at>=date_trunc('day',now())", [actor.id]);
        if (daily >= 500)
            throw conflict('今日上传次数已达上限。');
        const sourceId = randomUUID();
        const assets = Object.entries(images).map(([variant, image]) => ({ id: variant === 'source' ? sourceId : randomUUID(), variant, key: actor.id + '/' + randomUUID() + '.jpg', image }));
        for (const asset of assets)
            await c.query(`INSERT INTO exam_app.media_assets(id,owner_user_id,object_key,variant,parent_asset_id,mime_type,byte_size,width,height,sha256,state,retention_until) VALUES($1,$2,$3,$4,$5,'image/jpeg',$6,$7,$8,$9,'quarantined',now()+interval '30 days')`, [asset.id, actor.id, asset.key, asset.variant, asset.variant === 'source' ? null : sourceId, asset.image.data.length, asset.image.info.width, asset.image.info.height, hash(asset.image.data)]);
        const model = assets.find(a => a.variant === 'model');
        if (!model)
            throw new Error('MODEL_IMAGE_MISSING');
        await c.query(`INSERT INTO exam_app.upload_intents(id,student_id,slot_id,client_request_id,expected_revision,object_key,max_bytes,state,asset_id,input_sha256,expires_at) VALUES($1,$2,$3,$4,0,$5,10485760,'created',$6,$7,now()+interval '24 hours')`, [randomUUID(), actor.id, slotId, requestId, model.key, model.id, inputHash]);
        return { existing: null, assets };
    });
    if (reservation.existing)
        return { id: reservation.existing };
    try {
        // Join every write before marking a failed family for GC; a late PUT must not
        // recreate an object that the failure cleanup already removed.
        const writes = await Promise.allSettled(reservation.assets.map(asset => storage.put(asset.key, asset.image.data)));
        const failed = writes.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        await tx(pool, async (c) => { await c.query(`UPDATE exam_app.media_assets SET state='ready' WHERE id=ANY($1::uuid[])`, [reservation.assets.map(a => a.id)]); await c.query(`UPDATE exam_app.upload_intents SET state='validated' WHERE student_id=$1 AND client_request_id=$2`, [actor.id, requestId]); });
    }
    catch (error) {
        await pool.query(`UPDATE exam_app.media_assets SET state='deleting' WHERE id=ANY($1::uuid[])`, [reservation.assets.map(a => a.id)]);
        await pool.query(`UPDATE exam_app.upload_intents SET state='rejected' WHERE student_id=$1 AND client_request_id=$2`, [actor.id, requestId]);
        throw error;
    }
    const model = reservation.assets.find(a => a.variant === 'model');
    if (!model)
        throw new Error('MODEL_IMAGE_MISSING');
    return { id: model.id };
}
// Decision: .agents/notes/implemented/rendering/2026-11-04-progressive-image-viewer.md
export async function imageAccess(pool: Pool, actor: ExamUser, id: string, view: ExamMediaView) {
    const asset = await one(pool, z.object({ parent: z.uuid().nullable(), key: z.string(), byteSize: z.number().int().positive(), allowed: z.boolean() }), `SELECT jsonb_build_object('parent',m.parent_asset_id,'key',m.object_key,'byteSize',m.byte_size,'allowed',m.owner_user_id=$3 OR EXISTS(
      SELECT 1 FROM exam_app.revision_images i JOIN exam_app.question_revisions v ON v.id=i.revision_id JOIN exam_app.question_slots q ON q.id=v.slot_id JOIN exam_app.exam_attempts x ON x.id=q.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id
      WHERE i.asset_id=m.id AND ${assignmentAccessSql}
    )) AS value FROM exam_app.media_assets m WHERE m.id=$1 AND m.state='ready'`, [id,isAdmin(actor),actor.id,actor.roles.includes('manager'),actor.roles.includes('support')]);
    if (!asset.allowed) throw forbidden();
    let selected = { key: asset.key, byteSize: asset.byteSize };
    if (view !== 'model') {
        const parent = asset.parent ?? id;
        selected = await one(pool, z.object({key:z.string(),byteSize:z.number().int().positive()}), 'SELECT jsonb_build_object(\'key\',object_key,\'byteSize\',byte_size) AS value FROM exam_app.media_assets WHERE state=\'ready\' AND (id=$1 AND $2=\'source\' OR parent_asset_id=$1 AND variant=$2) LIMIT 1', [parent, view]);
    }
    await audit(pool, actor.id, 'media.read', id, 'media');
    return selected;
}
export async function readImage(pool: Pool, storage: ExamStorage, actor: ExamUser, id: string, view: ExamMediaView) {
    return storage.get((await imageAccess(pool, actor, id, view)).key);
}
// Solver input budget. The student-facing preview keeps the 2048px/q92 copy; the model
// receives a smaller copy so the paid call carries fewer image bytes. Measured on real
// cloud questions: 819KB primary + 1.4MB act views -> 354KB + 453KB, first token 2.2s -> 1.5s.
// Evidence: .runtime/speed-2026-11-07/ab-report.json
// Decision: .agents/notes/implemented/architecture/2026-11-07-solver-image-budget.md
export const SOLVER_IMAGE_WIDTH = 1600;
export const SOLVER_IMAGE_QUALITY = 85;
export async function solverImage(bytes: Uint8Array) {
    return sharp(bytes, { limitInputPixels: 20000000 }).resize({ width: SOLVER_IMAGE_WIDTH, height: SOLVER_IMAGE_WIDTH, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: SOLVER_IMAGE_QUALITY }).toBuffer();
}
export async function prepareActViews(input: SolverInput, signal: AbortSignal): Promise<NormalizedImage[]> {
    const info = await sharp(input.image.bytes, { limitInputPixels: 20000000 }).metadata();
    if (!info.width || !info.height)
        return [];
    const width = Math.max(1, Math.floor(info.width * .65));
    const result: NormalizedImage[] = [];
    for (const fraction of [0, .35]) {
        signal.throwIfAborted();
        const left = Math.min(info.width - width, Math.floor(info.width * fraction));
        const bytes = await sharp(input.image.bytes).extract({ left, top: 0, width, height: info.height }).resize({ width: SOLVER_IMAGE_WIDTH, height: SOLVER_IMAGE_WIDTH, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: SOLVER_IMAGE_QUALITY }).toBuffer();
        if (bytes.length <= EXAM_MODEL_IMAGE_BYTES)
            result.push({ bytes: Uint8Array.from(bytes), mimeType: 'image/jpeg' });
    }
    return result;
}
