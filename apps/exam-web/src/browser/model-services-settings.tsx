import { useEffect, useRef, useState } from 'react';
import { Select } from '@solveflow/web-ui/select';
import { Icon } from '@solveflow/web-ui/icons';
import { resolveThinking, type LocalModelProfile, type ThinkingControl } from '@solveflow/contracts/local';
import { ExamModelServiceAdminSchema, ExamModelServicesAdminSchema, ExamModelServiceUpdateSchema, ExamModelServiceCheckSchema, ExamModelServiceCheckResultSchema, type ExamModelServiceAdmin, type ExamModelServiceCode, type ExamModelServiceUpdate } from '@solveflow/contracts/exam-model-services';
import { api, post } from './api.js';
import { ErrorText, Feedback } from './components.js';
import './model-services.css';

type Role = 'solver' | 'verifier' | 'backup';
type Draft = Omit<ExamModelServiceUpdate,'models'> & { models: NonNullable<ExamModelServiceUpdate['models']> };
const roles: {value:Role;label:string}[] = [{value:'solver',label:'解题模型'},{value:'verifier',label:'核验模型'},{value:'backup',label:'自动备用'}];
const blank: LocalModelProfile = {provider:'openai',baseURL:'',model:'',api:'openai-completions',contextWindow:32768,maxTokens:8192,maxTokensField:'max_tokens'};
function draftOf(row: ExamModelServiceAdmin): Draft {return {expectedVersion:row.version,name:row.name,enabled:row.enabled,models:row.models??{solver:{...blank},verifier:{...blank},backup:null},keys:{solver:null,verifier:null,backup:null}};}

export function ModelServicesSettings() {
    const [rows,setRows]=useState<ExamModelServiceAdmin[]|null>(null),[selected,setSelected]=useState<ExamModelServiceCode>('primary'),[role,setRole]=useState<Role>('solver');
    const [drafts,setDrafts]=useState<Record<ExamModelServiceCode,Draft|null>>({primary:null,backup:null}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
    const active=useRef<AbortController|null>(null);
    async function load() {
        const controller=new AbortController();active.current?.abort();active.current=controller;setBusy(true);setError('');setMessage('');
        try{const next=await api('/admin/model-services',ExamModelServicesAdminSchema,{signal:controller.signal});if(controller.signal.aborted)return;const primary=next.find(row=>row.code==='primary'),backup=next.find(row=>row.code==='backup');if(!primary||!backup)throw new Error('服务方案不完整，请联系管理员。');setRows(next);setDrafts({primary:draftOf(primary),backup:draftOf(backup)});}
        catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'读取服务配置失败。');}
        finally{if(!controller.signal.aborted)setBusy(false);}
    }
    useEffect(()=>{void load();return()=>active.current?.abort();},[]);
    const row=rows?.find(item=>item.code===selected),draft=drafts[selected],profile=draft?.models[role]??null;
    function edit(patch: Partial<Draft>) {setDrafts(current=>{const source=current[selected];return source?{...current,[selected]:{...source,...patch}}:current;});setError('');setMessage('');}
    function editProfile(patch: Partial<LocalModelProfile>) {if(!draft||!profile)return;edit({models:{...draft.models,[role]:{...profile,...patch}}});}
    function thinking(patch: Partial<ThinkingControl>) {if(profile)editProfile({thinking:{...resolveThinking(profile),...patch}});}
    async function save() {
        if(!draft||busy)return;
        const noProfiles=!draft.enabled&&!draft.models.solver.baseURL&&!draft.models.solver.model&&!draft.models.verifier.baseURL&&!draft.models.verifier.model;
        const parsed=ExamModelServiceUpdateSchema.safeParse({...draft,models:noProfiles?null:draft.models});
        if(!parsed.success){setError('请检查模型地址、模型名、输出容量和密钥；输出上限不能超过上下文容量。');return;}
        const controller=new AbortController();active.current?.abort();active.current=controller;setBusy(true);setError('');setMessage('');
        try{const next=await api('/admin/model-services/'+selected,ExamModelServiceAdminSchema,{...post(parsed.data),signal:controller.signal});if(controller.signal.aborted)return;setRows(current=>current?.map(row=>row.code===next.code?next:row)??[next]);setDrafts(current=>({...current,[next.code]:draftOf(next)}));setMessage('已保存，后续新任务使用此配置。');}
        catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'保存失败，请重新读取配置。');}
        finally{if(!controller.signal.aborted)setBusy(false);}
    }
    async function check() {
        if(!draft||!profile||busy)return;
        const parsed=ExamModelServiceCheckSchema.safeParse({expectedVersion:draft.expectedVersion,role,profile,key:draft.keys[role]});
        if(!parsed.success){setError('请先填写完整的模型配置。');return;}
        const controller=new AbortController();active.current?.abort();active.current=controller;setBusy(true);setError('');setMessage('');
        try{const result=await api('/admin/model-services/'+selected+'/check',ExamModelServiceCheckResultSchema,{...post(parsed.data),signal:controller.signal});if(!controller.signal.aborted)setMessage(result.modelListed?'接口连接正常，目录包含该模型；未执行付费解题。':'接口连接正常，但目录未列出该模型，请核对名称。');}
        catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'接口检查失败。');}
        finally{if(!controller.signal.aborted)setBusy(false);}
    }
    const thought=profile?resolveThinking(profile):null;
    return <section className="model-services-page" aria-label="模型服务配置">
      {!rows&&!error&&<p className="empty" role="status">正在读取服务配置…</p>}
      {rows&&<div className="model-service-tabs" role="group" aria-label="服务配置">{rows.map(item=><button key={item.code} aria-pressed={selected===item.code} className={'model-service-tab'+(selected===item.code?' selected':'')} disabled={busy} onClick={()=>{setSelected(item.code);setRole('solver');setError('');setMessage('');}}><Icon name={item.code==='primary'?'pulse':'monitor'}/><span><strong>{item.name}</strong><small>{item.enabled?'已启用':'未启用'} · 版本 {item.version}</small></span></button>)}</div>}
      {row&&draft&&<div className="card service-editor">
        <div className="section-head"><h2>{row.name}</h2><label className="inline-check"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event=>edit({enabled:event.target.checked})}/>允许学生选择</label></div>
        <label>学生显示名称<input maxLength={40} value={draft.name} disabled={busy} onChange={event=>edit({name:event.target.value})}/></label>
        <div className="service-role-toolbar"><div className="service-roles" role="group" aria-label="模型角色">{roles.map(item=><button key={item.value} aria-pressed={role===item.value} className={role===item.value?'selected':''} disabled={busy} onClick={()=>{setRole(item.value);setError('');setMessage('');}}>{item.label}</button>)}</div>{role==='backup'&&<label className="inline-check"><input type="checkbox" checked={!!profile} disabled={busy} onChange={event=>edit({models:{...draft.models,backup:event.target.checked?{...blank}:null},keys:{...draft.keys,backup:null}})}/>启用自动备用</label>}</div>
        {profile&&thought?<><div className="service-fields" aria-label={roles.find(item=>item.value===role)?.label}>
          <label>供应商标识<input maxLength={80} value={profile.provider} disabled={busy} onChange={event=>editProfile({provider:event.target.value})}/></label>
          <label>模型名称<input maxLength={200} value={profile.model} disabled={busy} onChange={event=>editProfile({model:event.target.value})}/></label>
          <label className="service-address">服务地址<input type="url" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={2048} placeholder="https://api.apiyi.com/v1" value={profile.baseURL} disabled={busy} onChange={event=>editProfile({baseURL:event.target.value})}/></label>
          <label className="service-secret">API Key<input type="password" autoComplete="new-password" spellCheck={false} maxLength={2048} placeholder={row.hasKeys[role]?'已配置，留空保留':'填写服务密钥'} value={draft.keys[role]??''} disabled={busy} onChange={event=>edit({keys:{...draft.keys,[role]:event.target.value.trim()||null}})}/></label>
          <Select label="接口协议" value={profile.api} disabled={busy} options={[{value:'openai-completions',label:'Chat Completions'},{value:'openai-responses',label:'Responses'}]} onChange={value=>{if(value==='openai-completions'||value==='openai-responses')editProfile({api:value});}}/>
          <Select label="响应方式" value={profile.streaming===undefined?'default':String(profile.streaming)} disabled={busy} options={[{value:'default',label:'按角色默认'},{value:'true',label:'流式'},{value:'false',label:'非流式'}]} onChange={value=>{if(value==='default'){const {streaming:_streaming,...rest}=profile;edit({models:{...draft.models,[role]:rest}});}else editProfile({streaming:value==='true'});}}/>
        </div><details><summary>高级参数</summary><div className="service-fields">
          <label>上下文容量<input type="number" min={4096} max={2000000} value={profile.contextWindow} disabled={busy} onChange={event=>editProfile({contextWindow:Number(event.target.value)})}/></label>
          <label>输出上限<input type="number" min={1024} max={32768} value={profile.maxTokens} disabled={busy} onChange={event=>editProfile({maxTokens:Number(event.target.value)})}/></label>
          <Select label="输出字段" value={profile.maxTokensField} disabled={busy} options={[{value:'max_tokens',label:'max_tokens'},{value:'max_completion_tokens',label:'max_completion_tokens'}]} onChange={value=>{if(value==='max_tokens'||value==='max_completion_tokens')editProfile({maxTokensField:value});}}/>
          <Select label="思考模式" value={thought.mode} disabled={busy} options={[{value:'provider-default',label:'服务商默认'},{value:'off',label:'关闭'},{value:'on',label:'开启'}]} onChange={value=>{if(value==='provider-default'||value==='off'||value==='on')thinking({mode:value});}}/>
          <Select label="思考协议" value={thought.protocol??''} disabled={busy} options={[{value:'',label:'按接口默认'},{value:'thinking-type',label:'thinking.type'},{value:'enable-thinking',label:'enable_thinking'},{value:'reasoning-effort',label:'reasoning_effort'}]} onChange={value=>{if(value==='thinking-type'||value==='enable-thinking'||value==='reasoning-effort')thinking({protocol:value});else {const {protocol:_protocol,...rest}=thought;editProfile({thinking:rest});}}}/>
          <Select label="思考强度" value={thought.effort??''} disabled={busy} options={[{value:'',label:'服务商默认'},{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'}]} onChange={value=>{if(value==='low'||value==='medium'||value==='high')thinking({effort:value});else {const {effort:_effort,...rest}=thought;editProfile({thinking:rest});}}}/>
        </div></details></>:<p className="service-empty">当前方案未启用自动备用。</p>}
        <p className="service-save-info"><Icon name="key"/>学生只能看到方案名称。密钥留空保留，更换服务地址须填写新密钥。</p>
        <ErrorText error={error}/>{message&&<Feedback tone="success">{message}</Feedback>}
        <div className="service-actions"><button className="quiet" disabled={busy} onClick={()=>void load()}>重新读取</button><button className="secondary" disabled={busy||!profile} onClick={()=>void check()}>检查接口</button><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?'处理中…':'保存配置'}</button></div>
      </div>}
      {!rows&&error&&<><ErrorText error={error}/><button className="secondary" disabled={busy} onClick={()=>void load()}>重新读取</button></>}
    </section>;
}
