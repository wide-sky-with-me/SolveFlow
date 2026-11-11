import { expect, it } from 'vitest';
import { LocalSettingsSchema, type LocalDiagnostic } from '@solveflow/contracts/local';
import type { SolverInput } from '@solveflow/contracts/agent';
import { solveOnDevice, type LocalFetch } from './mobile.js';

const profile = {provider:'fixture',baseURL:'https://primary.invalid/v1',model:'primary',api:'openai-completions',contextWindow:32768,maxTokens:8192,maxTokensField:'max_tokens'};
const settings = LocalSettingsSchema.parse({schemaVersion:1,solver:profile,verifier:{...profile,baseURL:'https://verifier.invalid/v1'},backup:{...profile,baseURL:'https://backup.invalid/v1'}});
const keys = {solver:'synthetic-primary',verifier:'synthetic-verifier',backup:'synthetic-backup'};
const input: SolverInput = {schemaVersion:1,role:'solver',answerMode:'brief',identity:{ownerId:'owner',sessionId:'session',runId:'progress'},message:'',image:{bytes:Uint8Array.of(1,2),mimeType:'image/jpeg'},evidence:[],verificationMode:'automatic'};
const answer = {schemaVersion:1,kind:'answer',problem:{text:'x+1=3',subject:'math',uncertainties:[]},answer:'x=2',steps:[],knowledgePoints:[],citationIds:[],clarificationQuestions:[]};
const pass = {schemaVersion:1,verdict:'pass',checked:['transcription','logic'],issues:[]};
const frame = (delta: object, finish: string|null = null) => `data: ${JSON.stringify({id:'fixture',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
const sse = (value: unknown) => new Response(frame({role:'assistant',content:JSON.stringify(value)})+frame({},'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});

it.each(['no_headers','keepalive_only','empty_content','partial_content'] as const)('hands over a stalled primary once without a same-provider retry: %s',async fault=>{
  const urls: string[] = [], entries: LocalDiagnostic[] = [], windows: number[] = [];
  const owner = new AbortController(), safety = setTimeout(()=>owner.abort(),150);
  try {
    const result = await solveOnDevice(input,settings,keys,async(url,init)=>{
      const host = new URL(String(url)).hostname; urls.push(host);
      if(host!=='primary.invalid')return sse(host==='backup.invalid'?answer:pass);
      if(fault==='no_headers')return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('PRIVATE_TRANSPORT_CANARY')),{once:true}));
      return new Response(new ReadableStream<Uint8Array>({start(stream){stream.enqueue(new TextEncoder().encode(fault==='keepalive_only'?': ping\n\n':frame({role:'assistant',content:fault==='empty_content'?'':'{"schemaVersion":'})));init?.signal?.addEventListener('abort',()=>stream.error(new Error('PRIVATE_STREAM_CANARY')),{once:true});}}),{headers:{'content-type':'text/event-stream'}});
    },owner.signal,()=>{},entry=>entries.push(entry),(callback,ms)=>{
      windows.push(ms);const fire=ms===(fault==='partial_content'?60_000:90_000),timer=fire?setTimeout(callback,5):null;return()=>{if(timer!==null)clearTimeout(timer);};
    });
    expect(result).toMatchObject({status:'completed',verified:true});
    expect(urls).toEqual(['primary.invalid','backup.invalid','verifier.invalid']);
    expect(windows).toContain(fault==='partial_content'?60_000:90_000);
    expect(entries).toContainEqual(expect.objectContaining({event:'failure',reason:fault==='partial_content'?'stream_idle':'first_content_timeout'}));
    expect(JSON.stringify(entries)).not.toContain('PRIVATE_');
    if(fault==='partial_content')expect(entries).toContainEqual(expect.objectContaining({event:'first_content',firstTokenMs:expect.any(Number)}));
  } finally {clearTimeout(safety);}
});

it('cancellation wins a first-content timeout race without starting a backup',async()=>{
  const owner=new AbortController(),urls:string[]=[];
  const result=await solveOnDevice(input,settings,keys,async(url,init)=>{urls.push(String(url));return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));},owner.signal,()=>{},()=>{},(callback,ms)=>{
    const timer=ms===90_000?setTimeout(()=>{owner.abort();callback();},0):ms===240_000?setTimeout(()=>owner.abort(),100):null;return()=>{if(timer!==null)clearTimeout(timer);};
  });
  expect(result.status).toBe('cancelled');expect(urls).toEqual(['https://primary.invalid/v1/chat/completions']);
});

it('keeps normal streamed answers and clears every request timer',async()=>{
  const urls:string[]=[],live=new Set<()=>void>();const entries:LocalDiagnostic[]=[];
  const result=await solveOnDevice(input,settings,keys,async url=>{const host=new URL(String(url)).hostname;urls.push(host);return sse(host==='verifier.invalid'?pass:answer);},new AbortController().signal,()=>{},entry=>entries.push(entry),(callback)=>{live.add(callback);return()=>{live.delete(callback);};});
  expect(result).toMatchObject({status:'completed',verified:true});expect(urls).toEqual(['primary.invalid','verifier.invalid']);expect(live.size).toBe(0);
  expect(entries).toContainEqual(expect.objectContaining({event:'first_content',role:'solver',firstTokenMs:expect.any(Number)}));
});

it('starts the first-content clock after admission rather than while waiting for a permit',async()=>{
  const windows:number[]=[],owner=new AbortController(),safety=setTimeout(()=>owner.abort(),150);
  const transport:LocalFetch=Object.assign(async(url:Parameters<LocalFetch>[0],init?:RequestInit,onDispatch?:()=>void)=>{
    const host=new URL(String(url)).hostname;
    if(host!=='primary.invalid')return sse(host==='backup.invalid'?answer:pass);
    expect(windows).not.toContain(90_000);expect(onDispatch).toBeTypeOf('function');onDispatch?.();expect(windows).toContain(90_000);
    return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('synthetic')),{once:true}));
  },{defersDispatch:true});
  try{const result=await solveOnDevice(input,settings,keys,transport,owner.signal,()=>{},()=>{},(callback,ms)=>{windows.push(ms);const timer=ms===90_000?setTimeout(callback,0):null;return()=>{if(timer!==null)clearTimeout(timer);};});expect(result).toMatchObject({status:'completed',verified:true});}finally{clearTimeout(safety);}
});
