import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest, type ClientRequest } from 'node:http';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { SolveOutcomeSchema } from '@solveflow/contracts/agent';
import { PhotoAuth } from './auth.js';
import { PhotoLedger } from './ledger.js';
import { createPhotoHandler, createPhotoTestServer, type PhotoServiceOptions } from './service.js';

const access = 'synthetic-public-photo-access-key';
const answer = SolveOutcomeSchema.parse({ schemaVersion:1,status:'completed',verified:false,verificationStatus:'not_requested',verification:null,warning:null,candidate:{schemaVersion:1,kind:'answer',problem:{text:'Synthetic 1+1',subject:'math',uncertainties:[]},answer:'2',steps:[],knowledgePoints:[],citationIds:[],clarificationQuestions:[]} });
it('shares per-account concurrency between durable jobs and the legacy stream endpoint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-mixed-limits-')); let calls=0, release=()=>{};
  const hold = new Promise<void>(resolve=>{release=resolve;});
  const options: PhotoServiceOptions = {origin:'http://127.0.0.1',auth:new PhotoAuth([{id:'account',hash:createHash('sha256').update(access).digest('hex')}],'synthetic-mixed-limits-secret'.repeat(2),false),ledger:new PhotoLedger(join(dir,'ledger.json')),publicDir:dir,jobDir:join(dir,'jobs'),async solve(){calls++;await hold;return answer;}};
  const handler=createPhotoHandler(options),server=createServer(handler);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('NO_PORT');options.origin=`http://127.0.0.1:${address.port}`;
  const post=(path:string,value:unknown,cookie='')=>fetch(options.origin+path,{method:'POST',headers:{origin:options.origin,cookie,'content-type':'application/json'},body:JSON.stringify(value)});
  try {
    const login=await post('/api/login',{key:access}),cookie=login.headers.get('set-cookie')!.split(';')[0]!;
    const image=await sharp({create:{width:100,height:60,channels:3,background:'#fff'}}).jpeg().toBuffer();
    const input=()=>({schemaVersion:1,requestId:randomUUID(),sessionId:randomUUID(),exam:'act',image:'data:image/jpeg;base64,'+image.toString('base64')});
    expect((await post('/api/jobs',input(),cookie)).status).toBe(202);expect((await post('/api/jobs',input(),cookie)).status).toBe(202);
    expect((await post('/api/solve',input(),cookie)).status).toBe(429);expect(calls).toBe(2);
  } finally {release();await handler.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});
it('does not dispatch a slow upload that was stopped before its body finished arriving', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-upload-cancel-')); let calls = 0, upload: ClientRequest | undefined;
  const options: PhotoServiceOptions = { origin:'http://127.0.0.1',auth:new PhotoAuth([{id:'account',hash:createHash('sha256').update(access).digest('hex')}],'synthetic-upload-cancel-secret'.repeat(2),false),ledger:new PhotoLedger(join(dir,'ledger.json')),publicDir:dir,jobDir:join(dir,'jobs'),async solve(){calls++;return answer;} };
  const server = createPhotoTestServer(options); await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address=server.address(); if(!address||typeof address==='string')throw new Error('NO_PORT'); options.origin=`http://127.0.0.1:${address.port}`;
  const post=(path:string,value:unknown,cookie='')=>fetch(options.origin+path,{method:'POST',headers:{origin:options.origin,cookie,'content-type':'application/json'},body:JSON.stringify(value)});
  try {
    const login = await post('/api/login',{key:access}), cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const image = await sharp({create:{width:100,height:60,channels:3,background:'#fff'}}).jpeg().toBuffer();
    const input={schemaVersion:1,requestId:randomUUID(),sessionId:randomUUID(),exam:'act',image:'data:image/jpeg;base64,'+image.toString('base64')}, bytes=JSON.stringify(input);
    const arriving = new Promise<void>(resolve => server.once('request',()=>resolve()));
    const response = new Promise<{status:number|undefined;body:unknown}>((resolve,reject)=> {
      upload=httpRequest(options.origin+'/api/jobs',{method:'POST',headers:{cookie,origin:options.origin,'content-type':'application/json','content-length':Buffer.byteLength(bytes)}},res=>{
        let data='';res.setEncoding('utf8');res.on('data',(chunk:string)=>{data+=chunk;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data)});}catch(error){reject(error);}});
      });upload.on('error',reject);upload.write(bytes.slice(0,-1));
    });
    await arriving; expect((await post('/api/jobs/'+input.requestId+'/cancel',{},cookie)).status).toBe(404);
    upload!.end(bytes.slice(-1)); expect(await response).toMatchObject({status:202,body:{status:'cancelled',outcome:null}}); expect(calls).toBe(0);
    expect((await (await post('/api/jobs',input,cookie)).json()).status).toBe('cancelled'); expect(calls).toBe(0);
  } finally { upload?.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true}); }
});
it('enforces login and origin at the backend, strips metadata, persists deduplication, and cancels disconnected work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-http-')); let calls = 0, aborted = 0; let hold = false;
  const seenImages: Uint8Array[] = [];
  await writeFile(join(dir, 'heic-worker-1-23-5.js'), 'onmessage=()=>{}');
  const options: PhotoServiceOptions = { origin:'http://127.0.0.1',auth:new PhotoAuth([{id:'account',hash:createHash('sha256').update(access).digest('hex')}],'synthetic-server-secret-'.repeat(3),false),ledger:new PhotoLedger(join(dir,'ledger.json')),publicDir:dir,
    async solve(request,_account,signal,onEvent) {
      calls++; seenImages.push(Buffer.from(request.image.split(',')[1]!, 'base64'));
      onEvent({schemaVersion:1,type:'run.status',runId:request.requestId,status:'solving'});
      if (hold) await new Promise<void>(resolve => { const cancel = () => { aborted++; resolve(); }; if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true}); });
      return answer;
    },
  };
  const server = createPhotoTestServer(options);
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve)); const address=server.address(); if(!address||typeof address==='string')throw new Error('NO_PORT'); options.origin=`http://127.0.0.1:${address.port}`;
  const image=await sharp({create:{width:100,height:60,channels:3,background:'#fff'}}).jpeg().withMetadata().toBuffer();
  const input={schemaVersion:1,requestId:randomUUID(),sessionId:randomUUID(),exam:'act',image:'data:image/jpeg;base64,'+image.toString('base64')};
  const post=(path:string,value:unknown,cookie='',origin=options.origin)=>fetch(options.origin+path,{method:'POST',headers:{'content-type':'application/json',origin,...(cookie?{cookie}:{})},body:JSON.stringify(value)});
  try {
    const codecWorker = await fetch(options.origin + '/heic-worker-1-23-5.js'); expect(codecWorker.status).toBe(200); expect(codecWorker.headers.get('cache-control')).toBe('no-cache');
    expect(codecWorker.headers.get('content-security-policy')).toContain("'wasm-unsafe-eval'"); expect(codecWorker.headers.get('content-security-policy')).not.toContain("'unsafe-eval'");
    expect((await post('/api/solve',input)).status).toBe(401); expect(calls).toBe(0);
    expect((await post('/api/login',{key:'synthetic-wrong-key'})).status).toBe(401);
    const login=await post('/api/login',{key:access}); expect(login.status).toBe(200); const cookie=login.headers.get('set-cookie')!;expect(cookie).toContain('HttpOnly');
    expect((await post('/api/solve',input,cookie,'https://evil.invalid')).status).toBe(403);
    expect((await post('/api/solve',{...input,baseURL:'https://evil.invalid'},cookie)).status).toBe(400);expect(calls).toBe(0);
    expect((await post('/api/solve',{...input,image:'data:image/jpeg;base64,aW52YWxpZA=='},cookie)).status).toBe(400);expect(calls).toBe(0);
    expect((await fetch(options.origin+'/__solveflow/web-env',{headers:{cookie}})).status).toBe(404);
    const response=await post('/api/solve',input,cookie);expect(response.status).toBe(200);expect(await response.text()).toContain('"answer":"2"');expect(calls).toBe(1);
    expect((await sharp(seenImages[0]).metadata()).exif).toBeUndefined();
    const duplicate=await post('/api/solve',input,cookie);expect(duplicate.status).toBe(400);expect(calls).toBe(1);
    hold=true;const controller=new AbortController(); const pending=await fetch(options.origin+'/api/solve',{method:'POST',headers:{'content-type':'application/json',origin:options.origin,cookie},body:JSON.stringify({...input,requestId:randomUUID()}),signal:controller.signal});
    expect(pending.status).toBe(200);controller.abort();await expect.poll(()=>aborted).toBe(1);
    const beforeLogout = aborted;
    const firstActive = await post('/api/solve', {...input,requestId:randomUUID()}, cookie);
    const secondActive = await post('/api/solve', {...input,requestId:randomUUID()}, cookie);
    expect(firstActive.status).toBe(200); expect(secondActive.status).toBe(200);
    expect((await post('/api/solve', {...input,requestId:randomUUID()}, cookie)).status).toBe(429);
    const logout=await post('/api/logout',{},cookie);expect(logout.status).toBe(200);
    await expect.poll(() => aborted).toBe(beforeLogout + 2);
    expect(await firstActive.text()).not.toContain('"type":"result"');
    expect(await secondActive.text()).not.toContain('"type":"result"');
    expect((await fetch(options.origin+'/api/session',{headers:{cookie}})).status).toBe(401);
  } finally { server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true}); }
},30000);
it('background jobs retain results on disconnect and allow only their authenticated owner to query or cancel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-background-http-'));
  let calls = 0, release = () => {}; const hold = new Promise<void>(resolve => { release = resolve; });
  const keys = ['synthetic-background-owner-key','synthetic-background-other-key'];
  const options: PhotoServiceOptions = { origin: 'http://127.0.0.1', auth: new PhotoAuth(keys.map((key,index) => ({ id: 'account-' + index, hash: createHash('sha256').update(key).digest('hex') })), 'synthetic-http-background-secret'.repeat(2), false), ledger: new PhotoLedger(join(dir,'ledger.json')), publicDir: dir, jobDir: join(dir,'jobs'), async solve() { calls++; await hold; return answer; } };
  const server = createPhotoTestServer(options); await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('NO_PORT'); options.origin = 'http://127.0.0.1:' + address.port;
  const post = (path:string, value:unknown, cookie='', origin=options.origin) => fetch(options.origin + path, { method: 'POST', headers: { origin, cookie, 'content-type':'application/json' }, body:JSON.stringify(value) });
  try {
    const cookies: string[] = []; for (const key of keys) { const login = await post('/api/login',{key}); expect(login.status).toBe(200); cookies.push(login.headers.get('set-cookie')!.split(';')[0]!); }
    const image = await sharp({create:{width:100,height:60,channels:3,background:'#fff'}}).jpeg().toBuffer();
    const request = {schemaVersion:1,requestId:randomUUID(),sessionId:randomUUID(),exam:'act',image:'data:image/jpeg;base64,'+image.toString('base64')};
    expect((await post('/api/jobs',request)).status).toBe(401);
    expect((await post('/api/jobs',request,cookies[0],'https://evil.invalid')).status).toBe(403);
    expect((await post('/api/jobs',{...request,model:'not-allowed'},cookies[0])).status).toBe(400);
    const accepted = await post('/api/jobs',request,cookies[0]); expect(accepted.status).toBe(202); await accepted.body?.cancel();
    expect((await post('/api/jobs',request,cookies[0])).status).toBe(202); expect(calls).toBe(1);
    const path = '/api/jobs/' + request.requestId;
    expect((await fetch(options.origin+path)).status).toBe(401);
    expect((await fetch(options.origin+path,{headers:{cookie:cookies[1]!}})).status).toBe(404);
    expect((await post(path+'/cancel',{},cookies[1])).status).toBe(404);
    expect((await (await fetch(options.origin+path,{headers:{cookie:cookies[0]!}})).json()).status).toBe('running');
    release(); await expect.poll(async () => (await (await fetch(options.origin+path,{headers:{cookie:cookies[0]!}})).json()).status).toBe('finished'); expect(calls).toBe(1);
    const result = await (await fetch(options.origin+path,{headers:{cookie:cookies[0]!}})).json(); expect(result.outcome).toEqual(answer);
  } finally { release(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(()=>resolve())); await rm(dir,{recursive:true,force:true}); }
});
