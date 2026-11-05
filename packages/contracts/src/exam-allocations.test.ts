import { expect, it } from 'vitest';
import { ExamSittingPublishSchema, ExamAllocationStaffSchema } from './managed-exam.js';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
it('bounds atomic exam publishing and rejects duplicated people and ownership injection',()=>{
    const input={requestId:id,sitting:{templateId:id,title:'合成考试',opensAt:'2026-11-04T00:00:00Z',closesAt:null},studentIds:[id],supportIds:[other]};
    expect(ExamSittingPublishSchema.parse(input).mode).toBe('original');
    for(const extra of [{studentIds:[]},{studentIds:[id,id]},{supportIds:[other,other]},{studentIds:Array(101).fill(id)},{supportIds:Array(33).fill(other)},{ownerId:id}])expect(ExamSittingPublishSchema.safeParse({...input,...extra}).success).toBe(false);
    expect(ExamAllocationStaffSchema.safeParse({requestId:id,expectedVersion:1,supportIds:[]}).success).toBe(true);
    expect(ExamAllocationStaffSchema.safeParse({requestId:id,expectedVersion:0,supportIds:[other]}).success).toBe(false);
});
