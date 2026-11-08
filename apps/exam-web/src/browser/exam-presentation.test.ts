import { describe, expect, it } from 'vitest';
import { ExamAssignmentSchema } from '@solveflow/contracts/managed-exam';
import { assignmentDisplay, editedExamTime, localExamTime } from './exam-presentation.js';
const base = ExamAssignmentSchema.parse({id:'00000000-0000-4000-8000-000000000001',studentId:'00000000-0000-4000-8000-000000000002',studentName:'合成学生',sittingId:'00000000-0000-4000-8000-000000000003',title:'合成考试',exam:'sat',opensAt:'2026-11-07T01:00:17.123Z',closesAt:null,state:'assigned',attemptId:null});
describe('exam display uses authoritative state and retains hidden time precision',()=>{
    it('retains seconds and milliseconds on name-only saves, but accepts deliberate time edits',()=>{
        const original=base.opensAt;
        expect(editedExamTime(localExamTime(original),original)).toBe(original);
        const changed=localExamTime('2026-11-08T02:15:00.000Z');
        expect(editedExamTime(changed,original)).toBe('2026-11-08T02:15:00.000Z');
    });
    it('does not guess eligibility from the client clock or the presence of an old attempt',()=>{
        const attemptId='00000000-0000-4000-8000-000000000004';
        expect(assignmentDisplay({...base,entryState:'available'})).toMatchObject({label:'可进入',tone:'success',canOpen:true,action:'开始考试'});
        expect(assignmentDisplay({...base,entryState:'available',attemptId})).toMatchObject({label:'进行中',tone:'warning',action:'继续考试'});
        expect(assignmentDisplay({...base,entryState:'ended',attemptId})).toMatchObject({label:'已结束',tone:'neutral',canOpen:true,action:'查看记录'});
        expect(assignmentDisplay({...base,entryState:'revoked',attemptId})).toMatchObject({label:'已撤回',canOpen:false});
        expect(assignmentDisplay({...base,entryState:'upcoming'},true)).toMatchObject({label:'待开始',canOpen:false});
        expect(assignmentDisplay({...base,entryState:'expired'})).toMatchObject({label:'已过期',canOpen:false});
    });
});
