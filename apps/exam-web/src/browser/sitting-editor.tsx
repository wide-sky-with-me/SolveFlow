import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Select } from '@solveflow/web-ui/select';
import { ExamTemplatePageSchema } from '@solveflow/contracts/managed-exam';
import { api, idResponse, post } from './api.js';
import { Dialog, ErrorText } from './components.js';
import { RemoteSelect } from './remote-select.js';
import { AllocationFields, allocationInput, allocationToken } from './allocation-fields.js';
export function SittingEditor({initialTemplate='',onClose,onSaved}:{initialTemplate?:string;onClose:()=>void;onSaved:()=>void}) {
    const [templateId,setTemplateId]=useState(initialTemplate),[timeMode,setTimeMode]=useState('limited'),[busy,setBusy]=useState(false),[ready,setReady]=useState(true),[error,setError]=useState('');
    const request=useRef<AbortController|null>(null),token=useRef<{key:string;id:string}|null>(null),unlimitedStart=useRef(new Date().toISOString());
    useEffect(()=>()=>request.current?.abort(),[]);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();if(busy)return;const form=new FormData(event.currentTarget),text=(name:string)=>String(form.get(name)??'');
        const controller=new AbortController();request.current=controller;setBusy(true);setError('');
        try{
            const payload={sitting:{templateId,title:text('title'),opensAt:timeMode==='limited'?new Date(text('opensAt')).toISOString():unlimitedStart.current,closesAt:timeMode==='limited'?new Date(text('closesAt')).toISOString():null},...allocationInput(form)};
            await api('/admin/sittings/publish',idResponse,{...post({requestId:allocationToken(token,payload),...payload}),signal:controller.signal});
            if(!controller.signal.aborted)onSaved();
        }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'保存失败，请重试。');}
        finally{if(!controller.signal.aborted)setBusy(false);}
    }
    return <Dialog title="新建考试场次" onClose={()=>{if(!busy)onClose();}}><form onSubmit={event=>void submit(event)}>
      <label>场次名称<input name="title" required maxLength={120} disabled={busy}/></label>
      <RemoteSelect label="考试模板" name="templateId" schema={ExamTemplatePageSchema} endpoint="/admin/templates/page" value={templateId} onChange={setTemplateId} required disabled={busy}/>
      <Select label="考试时间" value={timeMode} onChange={setTimeMode} disabled={busy} options={[{value:'limited',label:'限定时间'},{value:'unlimited',label:'不限时间'}]}/>
      {timeMode==='limited'&&<div className="sitting-time-fields"><label>开始时间<input type="datetime-local" name="opensAt" required disabled={busy}/></label><label>结束时间<input type="datetime-local" name="closesAt" required disabled={busy}/></label></div>}
      <AllocationFields templateId={templateId} disabled={busy} onReady={setReady}/><ErrorText error={error}/>
      <div className="dialog-footer"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy||!ready||!templateId} type="submit">{busy?'保存中…':'保存'}</button></div>
    </form></Dialog>;
}
