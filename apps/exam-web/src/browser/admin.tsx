import { Select } from '@solveflow/web-ui/select';
import { Monitor } from './monitor.js';
import { IssueQueue } from './issue-queue.js';
import { Dashboard } from './dashboard.js';
import { CatalogPicker } from './template-picker.js';
import { useState, type FormEvent } from 'react';
import { ExamUserSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { EXAM_LABELS, ExamTypeSchema } from '@solveflow/contracts/exam';
import { Icon } from '@solveflow/web-ui/icons';
import { api, idResponse, post } from './api.js';
import { Dialog, ErrorText } from './components.js';
import { AssignmentList, SittingList, TemplateList, TrackingList, UserList } from './management-lists.js';
import { SittingEditor } from './sitting-editor.js';
import { SittingAllocations } from './sitting-allocations.js';
import { TeacherAttention } from './teacher-attention.js';
const roleLabels = { student: '学生', support: '老师 / 技术支持', manager: '场次管理员', admin: '系统管理员' };
export function Admin({ user, collapsed=false, mobileNav=false, onNavClose=()=>{} }:{user:ExamUser;collapsed?:boolean;mobileNav?:boolean;onNavClose?:()=>void}) {
    const [page,setPage]=useState('overview'),[issueFilter,setIssueFilter]=useState(''),[issueScene,setIssueScene]=useState(''),[error,setError]=useState(''),[version,setVersion]=useState(0),[tab,setTab]=useState('sittings'),[trackingScene,setTrackingScene]=useState('');
    const [dialog,setDialog]=useState<'user'|'sitting'|'template'|'catalog'|null>(null),[editing,setEditing]=useState<ExamUser|null>(null),[busy,setBusy]=useState(false),[watch,setWatch]=useState<string|null>(null),[watchSlot,setWatchSlot]=useState<string|undefined>(undefined);
    const [templateChoice,setTemplateChoice]=useState(''),[allocationSitting,setAllocationSitting]=useState<string|null>(null);
    const manager=user.roles.includes('manager')||user.roles.includes('admin');
    function refresh(){setVersion(value=>value+1);}
    function watchStudent(id:string){setWatchSlot(undefined);setWatch(id);}
    const nav=[['overview','看板首页'],['tracking','实时跟踪'],['issues','待处理题'],...(manager?[['users','用户管理'],['sittings','考试安排']]:[]),['statistics','答题统计'],['wall','数据大屏'],...(user.roles.includes('admin')?[['roles','角色权限']]:[])];
    async function submitForm(event:FormEvent<HTMLFormElement>){
        event.preventDefault();if(busy)return;const form=new FormData(event.currentTarget),value=(key:string)=>String(form.get(key)??'');setBusy(true);setError('');
        try{
            if(dialog==='user'){
                const roles=user.roles.includes('admin')?form.getAll('roles').map(String):['student'];
                const data={username:value('username'),displayName:value('displayName'),password:value('password'),roles};
                if(editing)await api('/admin/users/'+editing.id,ExamUserSchema,post({displayName:data.displayName,roles,state:value('state'),...(data.password?{password:data.password}:{})}));
                else await api('/admin/users',ExamUserSchema,post(data));
            }else if(dialog==='template'){
                const modules=value('modules').split('\n').filter(line=>line.trim()).map((line,i)=>{const [title,count]=line.split(/[,:，：]/);return{code:'module-'+(i+1),sectionCode:'section-'+(i+1),title:title?.trim()??'',questionCount:Number(count),durationSeconds:null,subject:value('subject')||'general',responseKinds:[value('responseKind')]};});
                await api('/admin/templates',idResponse,post({code:value('code'),title:value('title'),exam:value('exam'),modules}));
            }
            setDialog(null);setEditing(null);await refresh();
        }catch(error){setError(error instanceof Error?error.message:'操作失败。');}finally{setBusy(false);}
    }
    const navigation=<nav aria-label="管理导航">{nav.map(([id,title])=><button key={id} aria-label={title} title={collapsed?title:undefined} aria-current={page===id?'page':undefined} className={page===id?'selected':''} onClick={()=>{setPage(id??'overview');if(id==='issues'){setIssueFilter('');setIssueScene('');}if(id==='tracking')setTrackingScene('');setError('');onNavClose();}}><Icon name={id==='overview'?'grid':id==='wall'?'monitor':id==='statistics'?'chart':id==='issues'?'alert':id==='tracking'?'history':id==='users'?'users':'book'}/><span className="nav-label">{title}</span></button>)}</nav>;
    return <div className={'admin-shell'+(collapsed?' sidebar-collapsed':'')}><aside className="sidebar">{navigation}</aside>{mobileNav&&<Dialog title="导航" className="navigation-drawer" onClose={onNavClose}>{navigation}</Dialog>}<main className="admin-content" aria-label={nav.find(item=>item[0]===page)?.[1]}>
    <ErrorText error={dialog?'':error}/>
    {['overview','statistics','wall'].includes(page)&&<Dashboard key={page} wall={page==='wall'} analytics={page==='statistics'} onWatch={watchStudent} onIssues={(reason,sitting)=>{setIssueFilter(reason??'');setIssueScene(sitting??'');setPage('issues');}} onExit={()=>setPage('overview')} onViewAll={sitting=>{setTrackingScene(sitting);setPage('tracking');}}/>}
    {page==='tracking'&&<TrackingList key={trackingScene} initialScene={trackingScene} onWatch={watchStudent}/>}
    {page==='issues'&&<IssueQueue key={JSON.stringify([issueFilter,issueScene])} initialReason={issueFilter} initialSitting={issueScene} onOpen={item=>{setWatchSlot(item.slotId);setWatch(item.attemptId);}}/>}
    {page==='users'&&<><div className="toolbar"><button className="primary" onClick={()=>{setEditing(null);setDialog('user');setError('');}}>＋ 新建用户</button></div><UserList version={version} admin={user.roles.includes('admin')} onEdit={person=>{setEditing(person);setDialog('user');setError('');}}/></>}
    {page==='sittings'&&<><div className="management-tabs" role="tablist" aria-label="考试管理">{[['sittings','场次'],['assignments','分配记录'],['templates','考试模板']].map(([id,title])=><button role="tab" key={id} aria-selected={tab===id} className={tab===id?'selected':''} onClick={()=>setTab(id??'sittings')}>{title}</button>)}</div>{tab==='templates'&&<div className="toolbar"><button className="primary" onClick={()=>setDialog('catalog')}>选择考试模板</button><button className="secondary" onClick={()=>setDialog('template')}>自定义模板</button></div>}{tab==='sittings'?<SittingList version={version} onCreate={()=>{setTemplateChoice('');setDialog('sitting');}} onManage={setAllocationSitting}/>:tab==='assignments'?<AssignmentList version={version} onWatch={watchStudent} onManage={setAllocationSitting}/>:<TemplateList version={version} onUse={item=>{setTemplateChoice(item.id);setDialog('sitting');}}/>}</>}
    {page==='roles'&&<section className="panel table-wrap"><table><thead><tr><th>角色</th><th>范围</th><th>操作</th></tr></thead><tbody><tr><td>学生</td><td>自己的考试</td><td>拍题、补图、回看</td></tr><tr><td>技术支持</td><td>分配给自己的学生</td><td>跟踪、重答、核验及人工确认</td></tr><tr><td>场次管理员</td><td>管理的场次</td><td>新建学生、发布、分配与统计</td></tr><tr><td>系统管理员</td><td>系统范围</td><td>用户身份、停用与配置</td></tr></tbody></table></section>}
    {dialog==='catalog'&&<CatalogPicker onClose={()=>{setDialog(null);void refresh();}}/>}
    {dialog==='sitting'&&<SittingEditor initialTemplate={templateChoice} onClose={()=>setDialog(null)} onSaved={()=>{setDialog(null);refresh();}}/>}
    {allocationSitting&&<SittingAllocations key={allocationSitting} id={allocationSitting} onClose={()=>setAllocationSitting(null)} onSaved={refresh}/>}
    {dialog && dialog !== 'catalog' && dialog !== 'sitting' && <Dialog title={dialog === 'user' ? (editing ? '编辑用户' : '新建用户') : '新增考试模板'} onClose={() => {
                if (!busy) {
                    setDialog(null);
                    setEditing(null);
                }
            }}><form onSubmit={e => void submitForm(e)}>
      {dialog === 'user' && <><label>姓名<input name="displayName" required maxLength={80} defaultValue={editing?.displayName ?? ''}/></label>{!editing && <label>用户名<input name="username" required pattern="[A-Za-z0-9_-]{3,64}" autoComplete="off"/></label>}<label>{editing ? '新密码（留空保留）' : '密码'}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required={!editing}/></label>{user.roles.includes('admin') && <fieldset><legend>角色</legend>{Object.entries(roleLabels).map(([role, name]) => <label className="check-label" key={role}><input name="roles" type="checkbox" value={role} defaultChecked={editing ? editing.roles.some(r => r === role) : role === 'student'}/>{name}</label>)}</fieldset>}{editing && <Select label="状态" name="state" defaultValue={editing.state} options={[{ value: "active", label: "正常" }, { value: "disabled", label: "停用" }]}/>}</>}
      {dialog === 'template' && <><label>模板名称<input name="title" required maxLength={120}/></label><label>标识<input name="code" pattern="[a-z0-9-]+" required maxLength={40}/></label><Select label="考试" name="exam" options={ExamTypeSchema.options.map(exam => ({ value: exam, label: EXAM_LABELS[exam] }))}/><label>学科<input name="subject" defaultValue="general" maxLength={40}/></label><Select label="题型" name="responseKind" options={[{ value: "single-choice", label: "单选" }, { value: "multiple-choice", label: "多选" }, { value: "numeric", label: "填数" }, { value: "short-answer", label: "简答" }, { value: "multipart", label: "多小问" }, { value: "essay", label: "写作" }, { value: "drawing", label: "作图" }]}/><label>模块与题数<textarea name="modules" required rows={5} placeholder={'阅读写作一，27\n阅读写作二，27\n数学一，22\n数学二，22'}/></label></>}
      <ErrorText error={error}/><div className="dialog-footer"><button type="button" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={busy} type="submit">{busy ? '保存中…' : '保存'}</button></div>
    </form></Dialog>}
    {watch && <Monitor key={watch + ':' + (watchSlot ?? '')} id={watch} {...(watchSlot ? { initialSlotId: watchSlot } : {})} onClose={() => setWatch(null)}/>}
  </main><TeacherAttention hidden={!!watch||!!dialog||!!allocationSitting||mobileNav} onOpen={item=>{setWatchSlot(item.slotId);setWatch(item.attemptId);}} onViewAll={()=>{setIssueFilter('');setIssueScene('');setPage('issues');}}/></div>;
}
