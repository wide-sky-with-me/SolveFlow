import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExamAllocationPageSchema, ExamUserPageSchema, type ExamAllocation } from '@solveflow/contracts/managed-exam';
import { api, idResponse, post } from './api.js';
import { Dialog, ErrorText } from './components.js';
import { RemoteMultiSelect } from './remote-select.js';
import { AllocationFields, AllocationModeFields, allocationInput, allocationToken } from './allocation-fields.js';
import { ListSearch, Pagination, pageUrl, useCanonicalPage, useListQuery, usePageResource } from './paging.js';

export function SittingAllocations({id,onClose,onSaved}:{id:string;onClose:()=>void;onSaved:()=>void}) {
    const list=useListQuery(),resource=usePageResource(ExamAllocationPageSchema,pageUrl('/admin/sittings/'+id+'/allocations',{page:list.page,pageSize:list.pageSize,q:list.q,config:'1'}));
    useCanonicalPage(list.page,resource.data,list.setPage);
    const [editing,setEditing]=useState<ExamAllocation|null>(null),[adding,setAdding]=useState(false),[confirm,setConfirm]=useState<ExamAllocation|null>(null),[busy,setBusy]=useState(false),[ready,setReady]=useState(true),[error,setError]=useState('');
    const request=useRef<AbortController|null>(null),token=useRef<{key:string;id:string}|null>(null);
    useEffect(()=>()=>request.current?.abort(),[]);
    async function save(path:string,payload:unknown) {
        if(busy)return;
        const controller=new AbortController();request.current=controller;setBusy(true);setError('');
        try{
            await api('/admin/sittings/'+id+'/allocations'+path,idResponse,{...post({requestId:allocationToken(token,{path,payload}),...(typeof payload==='object'&&payload?payload:{})}),signal:controller.signal});
            if(controller.signal.aborted)return;
            setEditing(null);setAdding(false);setConfirm(null);onSaved();await resource.refresh(true);
        }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'保存失败，请重试。');}
        finally{if(!controller.signal.aborted)setBusy(false);}
    }
    function submit(event:FormEvent<HTMLFormElement>){
        event.preventDefault();const form=new FormData(event.currentTarget);
        if(!editing){void save('',allocationInput(form));return;}
        const mode=String(form.get('mode')),wrongCounts=form.getAll('wrongCounts').map(Number);
        const changed=!editing.started&&(mode!==(editing.mode??'original')||mode==='practice_simulation'&&JSON.stringify(wrongCounts)!==JSON.stringify(editing.wrongCounts??[]));
        void save('/'+editing.id+'/update',{expectedVersion:editing.version,supportIds:form.getAll('supportIds').map(String).sort(),...changed?{settings:{mode,wrongCounts}}:{}});
    }
    function back(){setEditing(null);setAdding(false);setError('');}
    return <><Dialog title={editing?'调整学生分配':adding?'添加学生':'人员与错题配置'} className="allocation-dialog" notice={error||resource.error ? <ErrorText error={error||resource.error}/> : null} onClose={()=>{if(!busy)onClose();}}>
      {editing||adding?<form onSubmit={submit}>
        {editing?<><h3 className="allocation-person">{editing.student.displayName}<span>{editing.student.username}</span></h3><RemoteMultiSelect key={editing.id} label="负责老师" name="supportIds" schema={ExamUserPageSchema} endpoint="/admin/users/page" params={{purpose:'support-assignment'}} initialSelected={editing.support} disabled={busy}/>{!editing.started&&resource.data&&<AllocationModeFields templateId={resource.data.sitting.templateId} disabled={busy} onReady={setReady} initialMode={editing.mode??'original'} initialCounts={editing.wrongCounts??[]}/>}</>:resource.data&&<AllocationFields templateId={resource.data.sitting.templateId} disabled={busy} onReady={setReady}/>}
        <div className="dialog-footer"><button type="button" disabled={busy} onClick={back}>返回</button><button className="primary" type="submit" disabled={busy||!resource.data||(adding||!!editing&&!editing.started)&&!ready}>{busy?'保存中…':'保存'}</button></div>
      </form>:<>
        <div className="section-head allocation-head"><h3>{resource.data?.sitting.title??'正在读取…'}</h3><button className="primary" disabled={!resource.data||resource.data.sitting.state!=='published'} onClick={()=>{setAdding(true);setError('');}}>添加学生</button></div>
        <ListSearch label="搜索已分配学生" value={list.q} onSearch={list.setQ}/>
        {resource.data&&<div className="table-wrap allocation-table"><table><thead><tr><th>学生</th><th>负责老师</th><th>状态</th><th>操作</th></tr></thead><tbody>{resource.data.items.map(item=><tr key={item.id}><td><strong>{item.student.displayName}</strong><span className="table-sub">{item.student.username}</span></td><td className="allocation-staff">{item.support.map(person=>person.displayName).join('、')||'—'}</td><td><span className="badge">{item.state==='revoked'?'已移除':item.started?'已参加':'已分配'}</span></td><td><div className="allocation-actions">{item.state==='revoked'?<button className="quiet" disabled={busy||resource.data?.sitting.state!=='published'} onClick={()=>void save('/'+item.id+'/state',{expectedVersion:item.version,action:'restore'})}>恢复</button>:<><button className="quiet" disabled={busy||resource.data?.sitting.state!=='published'} onClick={()=>{setEditing(item);setError('');}}>调整</button><button className="quiet" disabled={busy||item.started||resource.data?.sitting.state!=='published'} title={item.started?'已参加考试，保留原分配记录':undefined} onClick={()=>{setConfirm(item);setError('');}}>移除</button></>}</div></td></tr>)}</tbody></table>{!resource.data.items.length&&<p className="empty">没有匹配记录</p>}</div>}
        <Pagination label="场次学生" data={resource.data} pendingPage={list} disabled={busy||resource.loading&&!resource.data} onPage={list.setPage} onPageSize={list.setPageSize}/>
      </>}
    </Dialog>{confirm&&<Dialog title="移除分配？" onClose={()=>{if(!busy)setConfirm(null);}}><p>移除 {confirm.student.displayName} 的分配后，该学生将无法进入本场考试。</p><ErrorText error={error}/><div className="dialog-footer"><button disabled={busy} onClick={()=>{setConfirm(null);setError('');}}>取消</button><button className="primary" disabled={busy} onClick={()=>void save('/'+confirm.id+'/state',{expectedVersion:confirm.version,action:'revoke'})}>确认移除</button></div></Dialog>}</>;
}
