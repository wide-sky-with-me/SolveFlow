// Decision: .agents/notes/implemented/architecture/2026-11-05-exam-client-recovery.md
import { useEffect, useRef, useState } from 'react';
import { ExamAssignmentPageSchema } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { Select } from '@solveflow/web-ui/select';
import { Dialog, ErrorText, QuestionNotices, RefreshButton } from './components.js';
import { ListSearch, Pagination, pageUrl, useCanonicalPage, useListQuery, usePageResource } from './paging.js';
import { StudentAttempt } from './student.js';
import { StudentPractice } from './practice.js';

export function StudentWorkspace({attempt,busy,error,onAttempt,onStart}:{attempt:string|null;busy:boolean;error:string;onAttempt:(id:string|null)=>void;onStart:(id:string)=>Promise<void>}) {
    const [readyExamId,setReadyExam]=useState<string|null>(null),[missedOpen,setMissedOpen]=useState(false);
    const readyShown=useRef(new Set<string>()),missedShown=useRef(0);
    const list=useListQuery(),[manual,setManual]=useState(false),autoEntered=useRef<string|null>(null),[lastAttention,setLastAttention]=useState(0);
    const resource=usePageResource(ExamAssignmentPageSchema,pageUrl('/me/assignments/page',{entryState:'1',page:list.page,pageSize:list.pageSize,q:list.q,state:list.filter,excludeAttemptId:attempt??undefined}));
    useCanonicalPage(list.page,attempt?null:resource.data,list.setPage);
    const readyExam=resource.data?.available.find(item=>item.id===readyExamId)??null;
    useEffect(()=>{if(readyExamId&&resource.data&&!readyExam){readyShown.current.delete(readyExamId);setReadyExam(null);}},[readyExamId,resource.data,readyExam]);
    useEffect(()=>{if(resource.data)setLastAttention(resource.data.attentionTotal);},[resource.data]);
    const attentionTotal=resource.data?.attentionTotal??lastAttention;
    useEffect(()=>{if(!resource.data)return;const total=resource.data.missedTotal;if(total>missedShown.current)setMissedOpen(true);if(total===0)setMissedOpen(false);missedShown.current=total;},[resource.data?.missedTotal]);
    useEffect(()=>{
        if(attempt||busy||manual||!resource.data)return;
        const available=resource.data.available;
        if(available.length!==1||!available[0]||autoEntered.current===available[0].id)return;
        const item=available[0];
        if(!item.attemptId&&item.closesAt===null){if(!readyShown.current.has(item.id)){readyShown.current.add(item.id);setReadyExam(item.id);}return;}
        autoEntered.current=item.id;
        if(item.attemptId)onAttempt(item.attemptId);else void onStart(item.id);
    },[attempt,busy,manual,resource.data,onAttempt,onStart]);
    function showAttention(){setManual(true);onAttempt(null);list.setFilter('attention');}
    return <main className={'student-content'+(attempt?' active-exam':'')}>
      {missedOpen&&<Dialog title="有考试已过期" onClose={()=>setMissedOpen(false)}><p>{resource.data?.missedTotal??missedShown.current} 场考试已错过开放时间，未开始计时。</p><div className="dialog-footer"><button onClick={()=>setMissedOpen(false)}>我已知晓</button><button className="primary" onClick={()=>{setManual(true);onAttempt(null);list.setFilter('expired');setMissedOpen(false);}}>查看过期考试</button></div></Dialog>}
      {readyExam&&!missedOpen&&!attempt&&<Dialog title="准备开始考试" onClose={()=>{setReadyExam(null);setManual(true);}}><h3>{readyExam.title}</h3><p>开始后持续计时，退出网页期间也会计入用时。</p><div className="dialog-footer"><button onClick={()=>{setReadyExam(null);setManual(true);}}>稍后开始</button><button className="primary" disabled={busy} onClick={()=>{const item=readyExam;setReadyExam(null);autoEntered.current=item.id;setManual(false);void onStart(item.id);}}>开始考试</button></div></Dialog>}
      <ErrorText error={error||resource.error}/>
      {attentionTotal>0&&<QuestionNotices label="其他考试待处理问题" title={attempt?'其他考试仍有题目待处理':'考试仍有题目待处理'} tone="error" emphasis><button onClick={showAttention}><span className="notice-question">查看待处理考试<span>{attentionTotal} 场</span></span><Icon name="chevron-right"/></button></QuestionNotices>}
      {attempt?<StudentAttempt key={attempt} id={attempt} onExit={()=>{setManual(true);onAttempt(null);}}/>:<>
        {resource.data && resource.data.available.length === 0 && <StudentPractice/>}
        {(!resource.data || resource.data.total > 0 || list.q || list.filter) && <>
        <div className="page-title"><h1>我的考试</h1><RefreshButton busy={resource.refreshing} disabled={resource.loading} onRefresh={resource.refreshManually}/></div>
        <div className="list-toolbar student-list-tools"><ListSearch label="搜索考试名称" value={list.q} onSearch={value=>{setManual(true);list.setQ(value);}}/><Select label="考试状态" value={list.filter} onChange={value=>{setManual(true);list.setFilter(value);}} options={[{value:'',label:'全部考试'},{value:'available',label:'可进入'},{value:'upcoming',label:'待开始'},{value:'ended',label:'已结束'},{value:'expired',label:'已过期'},{value:'attention',label:'待处理'},{value:'revoked',label:'已撤回'}]}/></div>
        {!resource.data&&!resource.error&&<section className="card empty">正在读取…</section>}
        {resource.data?.items.map(item=>{const entry=item.entryState??(item.state==='revoked'?'revoked':item.expired?'expired':item.attemptEnded?'ended':resource.data?.available.some(candidate=>candidate.id===item.id)?'available':'unavailable');return <section className="card assignment-card" key={item.id}><div className="section-head"><h2>{item.title}</h2><span className="badge">{entry==='available'&&item.attemptId?'进行中':({available:'可进入',upcoming:'待开始',ended:'已结束',expired:'已过期',revoked:'已撤回',unavailable:'暂不可进入'}[entry])}</span></div><p className="muted">{new Date(item.opensAt).toLocaleString('zh-CN')}{item.closesAt ? ' — '+new Date(item.closesAt).toLocaleTimeString('zh-CN') : ' · 不限时'}</p><button className="primary full" disabled={busy||entry==='revoked'||!item.attemptId&&entry!=='available'} onClick={()=>{autoEntered.current=item.id;setManual(false);if(item.attemptId)onAttempt(item.attemptId);else void onStart(item.id);}}><Icon name={item.attemptId?'history':'camera'}/>{item.attemptId?'继续查看':item.closesAt===null?'开始考试':'进入考试'}</button></section>;})}
        <Pagination label="我的考试" data={resource.data} pendingPage={list} disabled={busy||resource.loading&&!resource.data} onPage={page=>{setManual(true);list.setPage(page);}} onPageSize={size=>{setManual(true);list.setPageSize(size);}}/>
        </>}
      </>}
    </main>;
}
