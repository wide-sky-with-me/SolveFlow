import { useEffect, type ReactNode } from 'react';
import type { z } from 'zod';
import { ExamAssignmentPageSchema, ExamChoicePageSchema, ExamProgressPageSchema, ExamSittingPageSchema, ExamTemplatePageSchema, ExamUserPageSchema, type ExamUser, type ExamTemplate } from '@solveflow/contracts/managed-exam';
import { EXAM_LABELS } from '@solveflow/contracts/exam';
import { Select, type SelectOption } from '@solveflow/web-ui/select';
import { ErrorText, RefreshButton } from './components.js';
import { StudentProgressTable } from './dashboard.js';
import { RemoteSelect } from './remote-select.js';
import { ListSearch, Pagination, pageUrl, useCanonicalPage, useListQuery, usePageResource } from './paging.js';

type Page<T>={items:T[];selected:T|null;total:number;page:number;pageSize:number;onlineTotal?:number};
type Filter={key:string;label:string;options:SelectOption[]};
const roles={student:'学生',support:'老师 / 技术支持',manager:'场次管理员',admin:'系统管理员'};
const states={active:'正常',disabled:'已停用',archived:'已归档'};

function ListPanel<T>({schema,endpoint,label,search,filters=[],render,version=0,scene,initialScene='',actions}:{schema:z.ZodType<Page<T>>;endpoint:string;label:string;search:string;filters?:Filter[];render:(items:T[])=>ReactNode;version?:number;scene?:boolean;initialScene?:string;actions?:ReactNode}) {
    const list=useListQuery();
    const resource=usePageResource(schema,pageUrl(endpoint,{...list.filters,sittingId:list.filters.sittingId??(initialScene||undefined),page:list.page,pageSize:list.pageSize,q:list.q}));
    useCanonicalPage(list.page,resource.data,list.setPage);
    useEffect(()=>{if(version)void resource.refresh(true);},[version]);
    return <section className="panel paged-panel" aria-label={label}>
      <div className="list-toolbar"><ListSearch label={search} value={list.q} onSearch={list.setQ}/>{actions}{filters.map(filter=><Select key={filter.key} label={filter.label} value={list.filters[filter.key]??''} onChange={value=>list.setParam(filter.key,value)} options={filter.options}/>)}{scene&&<RemoteSelect label="考试场次" allLabel="全部场次" value={list.filters.sittingId??initialScene} onChange={value=>list.setParam('sittingId',value)} schema={ExamChoicePageSchema} endpoint="/admin/dashboard/sittings/page"/>}<RefreshButton busy={resource.refreshing} disabled={resource.loading} onRefresh={resource.refreshManually}/></div>
      <ErrorText error={resource.error}/>{resource.data?.onlineTotal!==undefined&&<div className="list-summary">{resource.data.onlineTotal} 位在线</div>}
      {!resource.data&&!resource.error&&<p className="empty">正在读取…</p>}{resource.data&&!resource.data.items.length&&<p className="empty">没有匹配记录</p>}{resource.data&&resource.data.items.length>0&&render(resource.data.items)}
      <Pagination label={label} data={resource.data} pendingPage={list} disabled={resource.loading&&!resource.data} onPage={list.setPage} onPageSize={list.setPageSize}/>
    </section>;
}

export function UserList({admin,onEdit,version}:{admin:boolean;onEdit:(user:ExamUser)=>void;version:number}) {
    return <ListPanel schema={ExamUserPageSchema} endpoint="/admin/users/page" label="用户列表" search="搜索姓名或用户名" version={version} filters={[{key:'role',label:'身份',options:[{value:'',label:'全部身份'},...Object.entries(roles).map(([value,label])=>({value,label}))]},{key:'state',label:'用户状态',options:[{value:'',label:'全部状态'},...Object.entries(states).map(([value,label])=>({value,label}))]}]} render={items=><div className="table-wrap"><table><thead><tr><th>学生 / 用户</th><th>身份</th><th>状态</th><th>操作</th></tr></thead><tbody>{items.map(person=><tr key={person.id}><td><strong>{person.displayName}</strong><span className="table-sub">{person.username}</span></td><td>{person.roles.map(role=>roles[role]).join('、')}</td><td>{states[person.state]}</td><td>{admin&&person.state!=='archived'&&<button className="quiet" onClick={()=>onEdit(person)}>编辑</button>}</td></tr>)}</tbody></table></div>}/>;
}

export function TrackingList({onWatch,initialScene=''}:{onWatch:(id:string)=>void;initialScene?:string}) {
    return <ListPanel schema={ExamProgressPageSchema} endpoint="/admin/progress/page" label="学生进度" search="搜索学生或场次" initialScene={initialScene} scene filters={[{key:'status',label:'答题状态',options:[{value:'',label:'全部状态'},{value:'online',label:'在线'},{value:'attention',label:'待处理'},{value:'active',label:'处理中'}]}]} render={items=><StudentProgressTable progress={items} onWatch={onWatch}/>}/>;
}

export function SittingList({version,onCreate,onManage}:{version:number;onCreate?:()=>void;onManage?:(id:string)=>void}) {
    return <ListPanel schema={ExamSittingPageSchema} endpoint="/admin/sittings/page" label="考试场次列表" search="搜索场次或模板" version={version} actions={onCreate&&<button className="primary" onClick={onCreate}>新建场次</button>} filters={[{key:'state',label:'场次状态',options:[{value:'',label:'全部状态'},{value:'published',label:'已发布'},{value:'closed',label:'已结束'},{value:'cancelled',label:'已取消'},{value:'draft',label:'草稿'}]}]} render={items=><div>{items.map(sitting=><article className="record-row sitting-record" key={sitting.id}><div><h3>{sitting.title}</h3><p>{new Date(sitting.opensAt).toLocaleString()}{sitting.closesAt ? ' — '+new Date(sitting.closesAt).toLocaleString() : ' · 不限时'}</p><span className="muted">{sitting.templateTitle} · {sitting.assignmentCount} 位学生</span></div>{onManage&&<button className="quiet" onClick={()=>onManage(sitting.id)}>调整分配</button>}</article>)}</div>}/>;
}

export function AssignmentList({version,onWatch,onManage}:{version:number;onWatch:(id:string)=>void;onManage?:(id:string)=>void}) {
    return <ListPanel schema={ExamAssignmentPageSchema} endpoint="/admin/assignments/page" label="考试分配列表" search="搜索学生或考试" version={version} scene filters={[{key:'state',label:'分配状态',options:[{value:'',label:'全部状态'},{value:'available',label:'可进入'},{value:'upcoming',label:'待开始'},{value:'ended',label:'已结束'},{value:'expired',label:'已过期'},{value:'attention',label:'待处理'},{value:'revoked',label:'已撤回'}]}]} render={items=><div className="table-wrap"><table><thead><tr><th>学生</th><th>考试</th><th>时间</th><th>待处理</th><th>操作</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.studentName}</td><td>{item.title}{item.expired&&<span className="badge amber">已过期</span>}</td><td>{new Date(item.opensAt).toLocaleString()}</td><td>{item.pendingReviewCount||'—'}</td><td><button className="quiet" disabled={!item.attemptId} onClick={()=>{if(item.attemptId)onWatch(item.attemptId);}}>查看</button>{onManage&&<button className="quiet" onClick={()=>onManage(item.sittingId)}>调整分配</button>}</td></tr>)}</tbody></table></div>}/>;
}

export function TemplateList({version,onUse}:{version:number;onUse:(template:ExamTemplate)=>void}) {
    return <ListPanel schema={ExamTemplatePageSchema} endpoint="/admin/templates/page" label="考试模板列表" search="搜索模板名称或标识" version={version} filters={[{key:'exam',label:'考试类型',options:[{value:'',label:'全部考试'},...Object.entries(EXAM_LABELS).map(([value,label])=>({value,label}))]}]} render={items=><div className="table-wrap"><table><thead><tr><th>模板</th><th>考试</th><th>版本</th><th>操作</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.title}<span className="table-sub">{item.code} · {item.modules.length} 个模块</span></td><td>{EXAM_LABELS[item.exam]}</td><td>{item.version}</td><td><button className="quiet" onClick={()=>onUse(item)}>新建场次</button></td></tr>)}</tbody></table></div>}/>;
}
