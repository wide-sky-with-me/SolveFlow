import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { event, one, templates, tx } from '@solveflow/db';
import type { ExamUser } from '@solveflow/contracts/managed-exam';

/** A v3 upgrade fixture uses only v3 columns, never a newer application's write path. */
export async function seedV3Attempt(pool: Pool, actor: ExamUser, assignmentId: string, templateId: string) {
  const template = (await templates(pool)).find(item => item.id === templateId);
  if (!template) throw new Error('FIXTURE_TEMPLATE_REQUIRED');
  return tx(pool, async c => {
    const policy = await one(c, z.object({ id: z.uuid(), approvedBy: z.uuid().nullable() }), `SELECT jsonb_build_object('id',id,'approvedBy',approved_by) AS value FROM exam_app.delivery_policies WHERE assignment_id=$1`, [assignmentId]);
    const policyId = policy.id;
    const id = randomUUID(), planId = randomUUID();
    await c.query(`INSERT INTO exam_app.exam_attempts(id,assignment_id,student_id,attempt_no,template_id,delivery_policy_id,template_snapshot,state,started_at) VALUES($1,$2,$3,1,$4,$5,$6,'in_progress',now())`, [id, assignmentId, actor.id, templateId, policyId, JSON.stringify(template)]);
    await c.query(`INSERT INTO exam_app.answer_plans(id,attempt_id,student_id,policy_id,version,seed,allocation,confidence,proposed_by,state,approved_by,frozen_at) VALUES($1,$2,$3,$4,1,$5,'{}','estimate','deterministic','frozen',$6,now())`, [planId, id, actor.id, policyId, Buffer.alloc(32, 1), policy.approvedBy]);
    let ordinal = 0, first: string | null = null;
    for (const [index, module] of template.modules.entries()) {
      const moduleId = randomUUID(), templateModule = await one(c, z.uuid(), 'SELECT id AS value FROM exam_app.template_modules WHERE template_id=$1 AND position=$2', [templateId, index + 1]);
      await c.query(`INSERT INTO exam_app.attempt_modules(id,attempt_id,student_id,template_module_id,position,section_code,title,question_count,rules_snapshot,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [moduleId, id, actor.id, templateModule, index + 1, module.sectionCode, module.title, module.questionCount, JSON.stringify(module), index ? 'available' : 'in_progress']);
      for (let position = 1; position <= module.questionCount; position++) {
        const slot = randomUUID(); first ??= slot;
        await c.query('INSERT INTO exam_app.question_slots(id,module_id,attempt_id,student_id,position,ordinal) VALUES($1,$2,$3,$4,$5,$6)', [slot, moduleId, id, actor.id, position, ++ordinal]);
        await c.query(`INSERT INTO exam_app.answer_plan_items(id,plan_id,attempt_id,student_id,slot_id,action) VALUES($1,$2,$3,$4,$5,'original')`, [randomUUID(), planId, id, actor.id, slot]);
      }
    }
    await c.query('UPDATE exam_app.exam_attempts SET next_slot_id=$2 WHERE id=$1', [id, first]);
    await c.query("UPDATE exam_app.delivery_policies SET state='frozen' WHERE id=$1", [policyId]);
    await event(c, id, 'attempt.started'); return { id };
  });
}
