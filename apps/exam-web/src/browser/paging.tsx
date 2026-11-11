// Decision: .agents/notes/implemented/architecture/2026-11-04-managed-list-pagination.md
// Decision: .agents/notes/implemented/architecture/2026-11-09-browser-sync-continuity.md
import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { Icon } from '@solveflow/web-ui/icons';
import { Select } from '@solveflow/web-ui/select';
import { api, RequestError } from './api.js';

export function pageUrl(endpoint: string, params: Record<string,string|number|undefined>) {
    const query=new URLSearchParams();for(const [key,value] of Object.entries(params))if(value!==undefined&&value!=='')query.set(key,String(value));
    return endpoint+'?'+query;
}

/** Poll silently; manual refresh adopts the same in-flight request. Query changes fence old results. */
export function usePageResource<T>(schema: z.ZodType<T>, url: string|null, interval=5000) {
    const [snapshot,setSnapshot]=useState<{key:string;data:T}|null>(null),[failure,setFailure]=useState<{key:string;message:string;status:number|null}|null>(null),[manualKey,setManualKey]=useState<string|null>(null);
    const active=useRef<{key:string;controller:AbortController;promise:Promise<void>;manual:boolean}|null>(null);
    const read=useCallback((force=false,manual=false)=>{
        if(!url)return Promise.resolve();
        if(active.current?.key===url&&!force){
            if(manual){active.current.manual=true;setManualKey(url);}
            return active.current.promise;
        }
        active.current?.controller.abort();const controller=new AbortController();
        const request={key:url,controller,promise:Promise.resolve(),manual};active.current=request;setManualKey(manual?url:null);
        request.promise=api(url,schema,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted&&active.current===request){setSnapshot({key:url,data});setFailure(null);}}).catch(error=>{if(!controller.signal.aborted&&active.current===request)setFailure({key:url,message:error instanceof Error?error.message:'读取失败。',status:error instanceof RequestError?error.status:null});}).finally(()=>{if(active.current===request){active.current=null;if(request.manual)setManualKey(null);}});
        return request.promise;
    },[schema,url]);
    const refresh=useCallback((force=false)=>read(force),[read]);
    const refreshManually=useCallback(()=>read(false,true),[read]);
    useEffect(()=>{
        void refresh();
        const foreground=()=>{if(document.visibilityState==='visible')void refresh();};
        const polling=!!url&&interval>0;
        const timer=polling?setInterval(foreground,interval):null;
        if(polling){document.addEventListener('visibilitychange',foreground);window.addEventListener('online',foreground);}
        return()=>{if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',foreground);window.removeEventListener('online',foreground);const old=active.current;active.current=null;old?.controller.abort();};
    },[refresh,url,interval]);
    const data=snapshot?.key===url?snapshot.data:null,error=failure?.key===url?failure.message:'';
    return {data,error,errorStatus:failure?.key===url?failure.status:null,loading:!!url&&data===null&&!error,refreshing:manualKey===url&&!!active.current?.manual,refresh,refreshManually};
}

export function useListQuery() {
    const [state,setState]=useState<{page:number;pageSize:number;q:string;filter:string;filters:Record<string,string>}>({page:1,pageSize:20,q:'',filter:'',filters:{}});
    return {...state,setParam:(key:string,value:string)=>setState(s=>({...s,filters:{...s.filters,[key]:value},page:1})),setPage:(page:number)=>setState(s=>({...s,page})),setPageSize:(pageSize:number)=>setState(s=>({...s,pageSize,page:1})),setQ:(q:string)=>setState(s=>({...s,q,page:1})),setFilter:(filter:string)=>setState(s=>({...s,filter,page:1}))};
}

export function ListSearch({value,onSearch,onDraftChange,label='搜索',disabled=false}:{value:string;onSearch:(q:string)=>void;onDraftChange?:(q:string)=>void;label?:string;disabled?:boolean}) {
    const [draft,setDraft]=useState(value);useEffect(()=>setDraft(value),[value]);
    function submit(){onSearch(draft.trim());}
    return <div className="list-search" role="search"><input type="search" aria-label={label} placeholder={label} maxLength={120} disabled={disabled} value={draft} onChange={e=>{setDraft(e.target.value);if(onDraftChange)onDraftChange(e.target.value);else if(!e.target.value)onSearch('');}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();submit();}}}/>{onDraftChange?<span className="list-search-mark" aria-hidden="true"><Icon name="search"/></span>:<button type="button" className="icon-button" aria-label={'提交'+label} disabled={disabled} onClick={submit}><Icon name="search"/></button>}</div>;
}

type PageMeta={page:number;pageSize:number;total:number};
export function Pagination({data,onPage,onPageSize,disabled=false,label='列表',compact=false,pendingPage}:{data:PageMeta|null;onPage:(page:number)=>void;onPageSize?:(size:number)=>void;disabled?:boolean;label?:string;compact?:boolean;pendingPage?:{page:number;pageSize:number}}) {
    const page=data?.page??pendingPage?.page??1,pages=Math.max(1,Math.ceil((data?.total??0)/(data?.pageSize??pendingPage?.pageSize??20))),[draft,setDraft]=useState(String(page));
    useEffect(()=>setDraft(String(page)),[page]);
    function jump(){const next=Number(draft);if(Number.isSafeInteger(next)&&next>0)onPage(Math.min(pages,next));else setDraft(String(page));}
    return <nav className={'pagination'+(compact?' compact':'')} aria-label={label+'分页'}>
      {!compact&&<span className="pagination-total">共 {data?data.total.toLocaleString('zh-CN'):'—'} 条</span>}
      {!compact&&onPageSize&&<Select label="每页条数" value={String(data?.pageSize??pendingPage?.pageSize??20)} disabled={disabled} onChange={value=>onPageSize(Number(value))} options={[20,50,100].map(n=>({value:String(n),label:n+'条 / 页'}))}/>}
      <div className="pagination-controls"><button type="button" className="secondary page-button" aria-label="上一页" disabled={disabled||!data||page<=1} onClick={()=>onPage(page-1)}><Icon name="chevron-right"/></button><span className="page-position">{compact?<span>第 {page} / {data?pages:'—'} 页</span>:<><input type="number" min={1} max={pages} aria-label="页码" value={draft} disabled={disabled||!data} onChange={e=>setDraft(e.target.value)} onBlur={()=>setDraft(String(page))} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();jump();}}}/><span>/ {data?pages:'—'} 页</span></>}</span><button type="button" className="secondary page-button" aria-label="下一页" disabled={disabled||!data||page>=pages} onClick={()=>onPage(page+1)}><Icon name="chevron-right"/></button></div>
    </nav>;
}

export function useCanonicalPage(page:number,data:PageMeta|null,onPage:(page:number)=>void) {
    useEffect(()=>{if(data&&data.page!==page)onPage(data.page);},[page,data?.page,onPage]);
}
