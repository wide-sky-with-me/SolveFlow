import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { SolveOutcomeSchema } from '@solveflow/contracts/agent';
import { PhotoAuth } from './auth.js';
import { PhotoLedger } from './ledger.js';
import { createPhotoTestServer, type PhotoServiceOptions } from './service.js';

const access = 'synthetic-public-photo-access-key';
const answer = SolveOutcomeSchema.parse({ schemaVersion:1,status:'completed',verified:false,verificationStatus:'not_requested',verification:null,warning:null,candidate:{schemaVersion:1,kind:'answer',problem:{text:'Synthetic 1+1',subject:'math',uncertainties:[]},answer:'2',steps:[],knowledgePoints:[],citationIds:[],clarificationQuestions:[]} });
it('enforces login and origin at the backend, strips metadata, persists deduplication, and cancels disconnected work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-http-')); let calls = 0, aborted = 0; let hold = false;
  const seenImages: Uint8Array[] = [];
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
