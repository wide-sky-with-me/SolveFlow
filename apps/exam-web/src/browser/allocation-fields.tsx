import { newRequestId } from './request-id.js';
import { useEffect, useState } from 'react';
import { Select } from '@solveflow/web-ui/select';
import { EXAM_ALLOCATION_BATCH, ExamTemplatePageSchema, ExamUserPageSchema } from '@solveflow/contracts/managed-exam';
import { RemoteMultiSelect } from './remote-select.js';
import { ErrorText } from './components.js';
import { pageUrl, usePageResource } from './paging.js';
export function AllocationModeFields({templateId,disabled,onReady,initialMode='original',initialCounts=[]}:{templateId:string;disabled:boolean;onReady:(ready:boolean)=>void;initialMode?:string;initialCounts?:number[]}) {
    const [mode,setMode]=useState(initialMode);
    const template=usePageResource(ExamTemplatePageSchema,mode==='practice_simulation'&&templateId?pageUrl('/admin/templates/page',{selectedId:templateId,pageSize:1}):null,0);
    useEffect(()=>onReady(mode==='original'||!!template.data?.selected),[mode,template.data?.selected,onReady]);
    return <><Select label="答案模式" name="mode" value={mode} onChange={setMode} disabled={disabled} options={[{value:'original',label:'正常答题'},{value:'practice_simulation',label:'错题模拟'}]}/>
      <ErrorText error={template.error}/>{mode==='practice_simulation'&&template.data?.selected?.modules.map((m,i)=><label key={templateId+':'+m.code}>{m.title} · 模拟错题数<input name="wrongCounts" type="number" min={0} max={m.questionCount} defaultValue={initialCounts[i]??0} required disabled={disabled} aria-label={m.title+'模拟错题数'}/></label>)}</>;
}
export function AllocationFields({templateId,disabled,onReady}:{templateId:string;disabled:boolean;onReady:(ready:boolean)=>void}) {
    return <><RemoteMultiSelect label="学生" name="studentIds" schema={ExamUserPageSchema} endpoint="/admin/users/page" params={{purpose:'student-assignment'}} max={EXAM_ALLOCATION_BATCH} required disabled={disabled}/>
      <RemoteMultiSelect label="负责老师" name="supportIds" schema={ExamUserPageSchema} endpoint="/admin/users/page" params={{purpose:'support-assignment'}} disabled={disabled}/>
      <AllocationModeFields templateId={templateId} disabled={disabled} onReady={onReady}/></>;
}
export function allocationInput(form: FormData) {
    return {studentIds:form.getAll('studentIds').map(String).sort(),supportIds:form.getAll('supportIds').map(String).sort(),mode:String(form.get('mode')),wrongCounts:form.getAll('wrongCounts').map(value=>Number(value))};
}
export function allocationToken(previous: {current:{key:string;id:string}|null}, value: unknown) {
    const key=JSON.stringify(value);
    if(previous.current?.key!==key)previous.current={key,id:newRequestId()};
    return previous.current.id;
}
