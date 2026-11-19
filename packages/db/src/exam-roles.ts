// Decision: .agents/notes/implemented/architecture/2026-11-19-ended-exam-alerts-roles-and-card-tracking.md
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import {
    ExamRoleListSchema,
    ExamRoleMembersUpdateSchema,
    ExamRoleProfileSchema,
    ExamRoleSchema,
    ExamRoleUpdateSchema,
    type ExamRole,
    type ExamUser,
} from '@solveflow/contracts/managed-exam';
import { audit, conflict, forbidden, hash, isAdmin, lockActor, one, rows, tx, userJson, type Queryable } from './exam-store.js';

const BUILT_IN_ROLES: readonly [ExamRole, string][] = [
    ['admin', '系统管理员'],
    ['manager', '场次管理员'],
    ['support', '老师 / 技术支持'],
    ['student', '学生'],
];

async function ensureBuiltInRoles(c: Queryable) {
    for (const [code, name] of BUILT_IN_ROLES) {
        await c.query('INSERT INTO exam_app.roles(id,code,name,built_in) VALUES($1,$2,$3,true) ON CONFLICT(code) DO NOTHING', [randomUUID(), code, name]);
    }
}

const roleProfileSql = `SELECT jsonb_build_object(
    'code', r.code,
    'name', r.name,
    'summary', r.summary,
    'note', r.note,
    'updatedAt', r.updated_at,
    'memberCount', (SELECT count(*)::integer FROM exam_app.user_roles ur JOIN exam_app.users u ON u.id=ur.user_id WHERE ur.role_id=r.id AND u.state='active'),
    'disabledCount', (SELECT count(*)::integer FROM exam_app.user_roles ur JOIN exam_app.users u ON u.id=ur.user_id WHERE ur.role_id=r.id AND u.state='disabled'),
    'members', coalesce((
      SELECT jsonb_agg(m.value ORDER BY m.state_rank, m.display_name, m.id)
      FROM (
        SELECT u.id, u.display_name, CASE WHEN u.state='active' THEN 0 ELSE 1 END AS state_rank, ${userJson} AS value
        FROM exam_app.user_roles ur
        JOIN exam_app.users u ON u.id=ur.user_id
        WHERE ur.role_id=r.id AND u.state<>'archived'
        ORDER BY CASE WHEN u.state='active' THEN 0 ELSE 1 END, u.display_name, u.id
        LIMIT 50
      ) m
    ), '[]'::jsonb)
  ) AS value
  FROM exam_app.roles r`;

const roleOrderSql = `CASE r.code WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'support' THEN 3 WHEN 'student' THEN 4 ELSE 5 END`;

async function readRoleProfile(c: Queryable, code: ExamRole) {
    return one(c, ExamRoleProfileSchema, `${roleProfileSql} WHERE r.code=$1`, [code]);
}

export async function listRoleProfiles(pool: pg.Pool, actor: ExamUser) {
    if (!isAdmin(actor)) throw forbidden();
    return tx(pool, async c => {
        await ensureBuiltInRoles(c);
        const items = await rows(c, ExamRoleProfileSchema, `${roleProfileSql} WHERE r.code IN ('admin','manager','support','student') ORDER BY ${roleOrderSql}`);
        return ExamRoleListSchema.parse({ items });
    });
}

export async function updateRoleProfile(pool: pg.Pool, actor: ExamUser, rawCode: unknown, rawInput: unknown) {
    if (!isAdmin(actor)) throw forbidden();
    const code = ExamRoleSchema.parse(rawCode);
    const input = ExamRoleUpdateSchema.parse(rawInput);
    const operation = 'role.update:' + code;
    return tx(pool, async c => {
        await c.query('SELECT pg_advisory_xact_lock(5839201003)');
        if (!isAdmin(await lockActor(c, actor))) throw forbidden();
        await ensureBuiltInRoles(c);
        const digest = hash(JSON.stringify(input));
        const saved = (await rows(c, z.object({ digest: z.string() }), `SELECT jsonb_build_object('digest',input_sha256) AS value FROM exam_app.idempotency_requests WHERE actor_id=$1 AND operation=$2 AND request_id=$3`, [actor.id, operation, input.requestId]))[0];
        if (saved) {
            if (saved.digest !== digest) throw conflict('操作内容已变化，请重新提交。');
            return readRoleProfile(c, code);
        }
        const roleId = await one(c, z.uuid(), 'UPDATE exam_app.roles SET name=$2,summary=$3,note=$4,updated_at=now() WHERE code=$1 RETURNING id AS value', [code, input.name, input.summary, input.note]);
        await audit(c, actor.id, 'role.update', roleId, 'role');
        const profile = await readRoleProfile(c, code);
        await c.query(`INSERT INTO exam_app.idempotency_requests(actor_id,operation,request_id,input_sha256,status,response_status,response,expires_at) VALUES($1,$2,$3,$4,'completed',200,$5,now()+interval '1 day')`, [actor.id, operation, input.requestId, digest, JSON.stringify({ code })]);
        return profile;
    });
}

export async function updateRoleMembers(pool: pg.Pool, actor: ExamUser, rawCode: unknown, rawInput: unknown) {
    if (!isAdmin(actor)) throw forbidden();
    const code = ExamRoleSchema.parse(rawCode);
    const input = ExamRoleMembersUpdateSchema.parse(rawInput);
    if (input.action === 'revoke' && code === 'admin' && input.userIds.includes(actor.id)) {
        throw conflict('不能移除自己的系统管理员角色。');
    }
    const operation = 'role.members:' + code;
    return tx(pool, async c => {
        await c.query('SELECT pg_advisory_xact_lock(5839201003)');
        if (!isAdmin(await lockActor(c, actor))) throw forbidden();
        await ensureBuiltInRoles(c);
        const digest = hash(JSON.stringify(input));
        const saved = (await rows(c, z.object({ digest: z.string() }), `SELECT jsonb_build_object('digest',input_sha256) AS value FROM exam_app.idempotency_requests WHERE actor_id=$1 AND operation=$2 AND request_id=$3`, [actor.id, operation, input.requestId]))[0];
        if (saved) {
            if (saved.digest !== digest) throw conflict('操作内容已变化，请重新提交。');
            return readRoleProfile(c, code);
        }
        const roleId = await one(c, z.uuid(), 'SELECT id AS value FROM exam_app.roles WHERE code=$1', [code]);
        const locked = await c.query(`SELECT id FROM exam_app.users WHERE id=ANY($1::uuid[]) AND state<>'archived' ORDER BY id FOR UPDATE`, [input.userIds]);
        if (locked.rowCount !== input.userIds.length) {
            throw conflict('所选用户不存在或已归档，请刷新后重试。');
        }
        let changedIds: string[] = [];
        if (input.action === 'revoke') {
            const soleHolder = (await rows(c, z.string(), `SELECT u.display_name AS value FROM exam_app.users u WHERE u.id=ANY($1::uuid[]) AND EXISTS(SELECT 1 FROM exam_app.user_roles ur WHERE ur.user_id=u.id AND ur.role_id=$2) AND (SELECT count(*) FROM exam_app.user_roles ur WHERE ur.user_id=u.id)<=1 ORDER BY u.display_name LIMIT 1`, [input.userIds, roleId]))[0];
            if (soleHolder) {
                throw conflict(`用户「${soleHolder}」仅剩该角色，请先为其分配其他角色后再移除。`);
            }
            changedIds = await rows(c, z.uuid(), 'DELETE FROM exam_app.user_roles WHERE role_id=$2 AND user_id=ANY($1::uuid[]) RETURNING user_id AS value', [input.userIds, roleId]);
        } else {
            changedIds = await rows(c, z.uuid(), 'INSERT INTO exam_app.user_roles(user_id,role_id) SELECT unnest($1::uuid[]),$2 ON CONFLICT DO NOTHING RETURNING user_id AS value', [input.userIds, roleId]);
        }
        if (changedIds.length) {
            await c.query('UPDATE exam_app.users SET auth_version=auth_version+1,updated_at=now() WHERE id=ANY($1::uuid[])', [changedIds]);
            await c.query('UPDATE exam_app.roles SET updated_at=now() WHERE id=$1', [roleId]);
            for (const userId of changedIds) {
                await audit(c, actor.id, input.action === 'grant' ? 'role.grant' : 'role.revoke', userId, 'user');
            }
        }
        const profile = await readRoleProfile(c, code);
        await c.query(`INSERT INTO exam_app.idempotency_requests(actor_id,operation,request_id,input_sha256,status,response_status,response,expires_at) VALUES($1,$2,$3,$4,'completed',200,$5,now()+interval '1 day')`, [actor.id, operation, input.requestId, digest, JSON.stringify({ code })]);
        return profile;
    });
}
