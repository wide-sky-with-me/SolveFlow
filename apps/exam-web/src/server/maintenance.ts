// Decision: .agents/notes/implemented/architecture/2026-11-04-managed-exam-audit-fixes.md
import type { Pool } from 'pg';
import { z } from 'zod';
import { one, rows, tx } from '@solveflow/db';
import type { ExamStorage } from './storage.js';
/** Claim complete image families before checking references; submissions hold image share locks. */
export async function collectGarbage(pool: Pool, storage: ExamStorage) {
    const references = `FROM exam_app.media_assets family JOIN exam_app.revision_images i ON i.asset_id=family.id WHERE family.id=source.id OR family.parent_asset_id=source.id`;
    // Apply eligibility before LIMIT so retained or active families cannot occupy every scan slot.
    // The locked family is checked again below to fence concurrent submissions.
    const sources = await rows(pool, z.string(), `SELECT source.id AS value FROM exam_app.media_assets source WHERE source.variant='source' AND source.state<>'deleted' AND source.delete_attempts<10 AND (source.state='deleting' OR source.retention_until<now() OR source.created_at<now()-interval '24 hours' AND NOT EXISTS(SELECT 1 ${references})) AND NOT EXISTS(SELECT 1 FROM exam_app.media_assets family JOIN exam_app.revision_images i ON i.asset_id=family.id JOIN exam_app.answer_runs r ON r.revision_id=i.revision_id WHERE (family.id=source.id OR family.parent_asset_id=source.id) AND r.finished_at IS NULL) ORDER BY source.created_at,source.id LIMIT 10`);
    let deleted = 0;
    const retries = await rows(pool, z.object({ id: z.uuid(), key: z.string() }), `UPDATE exam_app.media_assets SET delete_attempts=delete_attempts+1 WHERE id IN (SELECT id FROM exam_app.media_assets WHERE state='deleting' AND delete_attempts<10 ORDER BY created_at LIMIT 20) RETURNING jsonb_build_object('id',id,'key',object_key) AS value`);
    for (const image of retries) {
        try {
            await storage.remove(image.key);
            await pool.query(`UPDATE exam_app.media_assets SET state='deleted',deleted_at=now() WHERE id=$1 AND state='deleting'`, [image.id]);
            deleted++;
        }
        catch {
            console.error(JSON.stringify({ event: 'exam.media.delete.failed' }));
        }
    }
    for (const sourceId of sources) {
        const batch = await tx(pool, async (c) => {
            const family = await rows(c, z.object({ id: z.uuid(), key: z.string() }), `SELECT jsonb_build_object('id',id,'key',object_key) AS value FROM exam_app.media_assets WHERE (id=$1 OR parent_asset_id=$1) AND state<>'deleted' AND delete_attempts<10 FOR UPDATE SKIP LOCKED`, [sourceId]);
            if (family.length !== 3)
                return [];
            const ids = family.map(v => v.id);
            const active = await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.revision_images i JOIN exam_app.answer_runs r ON r.revision_id=i.revision_id WHERE i.asset_id=ANY($1::uuid[]) AND r.finished_at IS NULL) AS value`, [ids]);
            if (active)
                return [];
            const disposable = await one(c, z.boolean(), `SELECT bool_and(state='deleting' OR retention_until<now() OR created_at<now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM exam_app.revision_images i WHERE i.asset_id=ANY($1::uuid[]))) AS value FROM exam_app.media_assets WHERE id=ANY($1::uuid[])`, [ids]);
            if (!disposable)
                return [];
            await c.query(`UPDATE exam_app.media_assets SET state='deleting',delete_attempts=delete_attempts+1 WHERE id=ANY($1::uuid[])`, [ids]);
            return family;
        });
        for (const image of batch) {
            try {
                await storage.remove(image.key);
                await pool.query(`UPDATE exam_app.media_assets SET state='deleted',deleted_at=now() WHERE id=$1 AND state='deleting'`, [image.id]);
                deleted++;
            }
            catch {
                console.error(JSON.stringify({ event: 'exam.media.delete.failed' }));
            }
        }
    }
    await tx(pool, async (c) => { await c.query(`UPDATE exam_app.attempt_streams s SET min_retained_seq=greatest(min_retained_seq,coalesce((SELECT max(seq) FROM exam_app.attempt_events e WHERE e.attempt_id=s.attempt_id AND e.created_at<now()-interval '7 days' AND e.seq<=s.last_seq-100),0))`); await c.query('DELETE FROM exam_app.attempt_events e USING exam_app.attempt_streams s WHERE e.attempt_id=s.attempt_id AND e.seq<=s.min_retained_seq'); });
    return deleted;
}
