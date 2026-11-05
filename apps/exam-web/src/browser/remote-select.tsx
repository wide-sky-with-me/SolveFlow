import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { Select } from '@solveflow/web-ui/select';
import { ErrorText } from './components.js';
import { ListSearch, Pagination, pageUrl, useListQuery, usePageResource } from './paging.js';

type Page<T>={items:T[];selected:T|null;page:number;pageSize:number;total:number};
export function RemoteSelect<T extends {id:string}>({schema,endpoint,label,name,value,onChange,onSelect,allLabel,required=false,disabled=false,params={}}:{schema:z.ZodType<Page<T>>;endpoint:string;label:string;name?:string;value?:string;onChange?:(id:string)=>void;onSelect?:(item:T|null)=>void;allLabel?:string;required?:boolean;disabled?:boolean;params?:Record<string,string|undefined>}) {
    const [local,setLocal]=useState(''),[open,setOpen]=useState(false),[chosen,setChosen]=useState<T|null>(null),list=useListQuery();
    const selected=value??local;const seeded=useRef(false);
    const resource=usePageResource(schema,(open||required||selected)?pageUrl(endpoint,{...params,page:list.page,pageSize:20,q:list.q,selectedId:selected||undefined}):null,0);
    const options=resource.data?.items??[];
    const item=options.find(item=>item.id===selected)??resource.data?.selected??(chosen?.id===selected?chosen:null);
    function choose(id:string){const next=options.find(item=>item.id===id)??(item?.id===id?item:null);setLocal(id);setChosen(next);onChange?.(id);onSelect?.(next);}
    useEffect(()=>{if(!resource.data)return;if(selected&&!resource.data.selected&&!resource.data.items.some(item=>item.id===selected)){seeded.current=true;choose('');}else if(required&&!selected&&!seeded.current&&resource.data.items[0]){seeded.current=true;choose(resource.data.items[0].id);}else if(resource.data.selected?.id===selected&&chosen?.id!==selected){setChosen(resource.data.selected);onSelect?.(resource.data.selected);}},[resource.data,selected,required]);
    const visible=[...(item&&!options.some(candidate=>candidate.id===item.id)?[item]:[]),...options];
    const labelOf=(item:T)=>{const record:unknown=item;const parsed=record&&typeof record==='object'?record:null;if(parsed&&'label'in parsed&&typeof parsed.label==='string')return parsed.label;if(parsed&&'displayName'in parsed&&typeof parsed.displayName==='string')return parsed.displayName+('username'in parsed?' · '+String(parsed.username):'');if(parsed&&'title'in parsed&&typeof parsed.title==='string')return parsed.title+('version'in parsed&&typeof parsed.version==='number'?' · 第'+parsed.version+'版':'');return item.id;};
    return <div className="remote-select"><Select label={label} {...(name?{name}:{})} value={selected} required={required} disabled={disabled} onChange={choose} options={[...(!required?[{value:'',label:allLabel??'全部'}]:[]),...visible.map(item=>({value:item.id,label:labelOf(item)}))]} onOpenChange={next=>{setOpen(next);if(next)void resource.refresh();}} menuHeader={<><ListSearch label={'搜索'+label} value={list.q} onSearch={list.setQ}/><ErrorText error={resource.error}/>{resource.loading&&!resource.data&&<span className="remote-status">正在读取…</span>}{resource.data&&!resource.data.items.length&&<span className="remote-status">没有匹配项</span>}</>} menuFooter={<Pagination label={label} compact data={resource.data} disabled={resource.loading} onPage={list.setPage}/>}/></div>;
}

export function RemoteMultiSelect<T extends {id:string;displayName:string}>({schema,endpoint,label,name,params,disabled=false,required=false,max=32,initialSelected=[]}:{schema:z.ZodType<Page<T>>;endpoint:string;label:string;name:string;params?:Record<string,string|undefined>;disabled?:boolean;required?:boolean;max?:number;initialSelected?:readonly T[]}) {
    const list=useListQuery(),[open,setOpen]=useState(false),[selected,setSelected]=useState<T[]>([...initialSelected]);
    const resource=usePageResource(schema,open?pageUrl(endpoint,{...params,page:list.page,pageSize:20,q:list.q}):null,0);
    const items=resource.data?.items??[];
    const visible=[...items,...selected.filter(item=>!items.some(candidate=>candidate.id===item.id))];
    function choose(ids:string[]){setSelected(ids.map(id=>selected.find(item=>item.id===id)??items.find(item=>item.id===id)).filter((item):item is T=>!!item));}
    const labelOf=(item:T)=>item.displayName+('username'in item?' · '+String(item.username):'');
    return <div className="remote-select remote-multi-select"><Select label={label} name={name} required={required} disabled={disabled} placeholder="请选择" options={visible.map(item=>({value:item.id,label:labelOf(item),...(!items.some(candidate=>candidate.id===item.id)?{group:'已选择'}:{})}))} selection={{values:selected.map(item=>item.id),onChange:choose,max}} onOpenChange={next=>{setOpen(next);if(next)void resource.refresh();}}
      menuHeader={<><ListSearch label={'搜索'+label} value={list.q} onSearch={list.setQ} disabled={disabled}/><ErrorText error={resource.error}/>{resource.loading&&!resource.data&&<span className="remote-status">正在读取…</span>}{resource.data&&!items.length&&<span className="remote-status">没有匹配项</span>}</>}
      menuFooter={<><div className="multi-selection-tools"><span>已选 {selected.length}</span><button type="button" className="quiet" disabled={!selected.length||disabled} onClick={()=>setSelected([])}>清空选择</button></div><Pagination label={label} data={resource.data} compact onPage={list.setPage} disabled={resource.loading||disabled}/></>}/></div>;
}
