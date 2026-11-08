import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { chromium, webkit, expect as browserExpect } from '@playwright/test';
import sharp from 'sharp';
import { connectDatabase, migrate, bootstrap, createUser, createTemplate, createSitting, createAssignment, startAttempt, snapshot, submit, claimJob, finishJob, teacherConfirm, navigateAttempt } from '@solveflow/db';
import { SolveOutcomeSchema } from '@solveflow/contracts/agent';
import { ExamAttemptSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { createExamService, hashPassword } from './service.js';
import { LocalExamStorage } from './storage.js';
import { upload } from './images.js';
const url=process.env.SOLVEFLOW_EXAM_TEST_DATABASE_URL;
if(url&&(new URL(url).hostname!=='127.0.0.1'||!/^\/solveflow_exam_test_[a-f0-9]{12}$/.test(new URL(url).pathname)))throw new Error('ISOLATED_DATABASE_REQUIRED');
const db=url?connectDatabase(url):null;
function pool(){if(!db)throw new Error('NO_DATABASE');return db.pool;}
let student:ExamUser,admin:ExamUser,outsider:ExamUser,attemptId='',root='',origin='',image:Buffer,storage:LocalExamStorage,service:ReturnType<typeof createExamService>,server:Server;
const header={'x-solveflow-answer-values':'1'};
function outcome(value:string,answer:string,type='numeric',verified=true){return SolveOutcomeSchema.parse({schemaVersion:1,status:'completed',verified,warning:null,...verified?{verification:{schemaVersion:1,verdict:'pass',checked:['transcription','logic'],issues:[]}}:{verification:null,verificationStatus:'not_requested'},candidate:{schemaVersion:1,kind:'answer',problem:{text:'Synthetic fill answer',subject:'math',response:{type},uncertainties:[]},...value?{responseValue:value}:{},answer,steps:[],knowledgePoints:[],citationIds:[],clarificationQuestions:[]}});}
async function finish(position:number,value:string,answer:string,type='numeric',verified=true){
  const target=(await snapshot(pool(),student,attemptId)).slots[position-1];if(!target)throw new Error('NO_TARGET');
  const asset=await upload(pool(),storage,student,target.id,randomUUID(),image);
  await submit(pool(),student,target.id,{requestId:randomUUID(),expectedRevision:target.revision,kind:target.revision?'retake':'initial',assetIds:[asset.id]});
  const job=await claimJob(pool());if(!job||job.slotId!==target.id)throw new Error('NO_JOB');
  expect(await finishJob(pool(),job,outcome(value,answer,type,verified),null)).toBe(true);
}
describe.skipIf(!url)('non-choice answer highlights and overview',()=>{
  beforeAll(async()=>{
    await migrate(pool());root=await mkdtemp(join(tmpdir(),'solveflow-answer-values-'));storage=new LocalExamStorage(root);
    const password=await hashPassword('synthetic-password-123');admin=await bootstrap(pool(),'admin','合成管理员',password);
    student=await createUser(pool(),admin,{username:'fill_student',displayName:'填空展示验收',password:'synthetic-password-123',roles:['student']},password);
    outsider=await createUser(pool(),admin,{username:'other_student',displayName:'其他学生',password:'synthetic-password-123',roles:['student']},password);
    const template=await createTemplate(pool(),admin,{code:'answer-values',title:'填空展示',exam:'sat',modules:[{code:'math',title:'数学',sectionCode:'math',questionCount:8,durationSeconds:null}]});
    const sitting=await createSitting(pool(),admin,{title:'填空答案验收',templateId:template.id,opensAt:new Date(Date.now()-60000).toISOString(),closesAt:null});
    const assignment=await createAssignment(pool(),admin,{sittingId:sitting.id,studentId:student.id});attemptId=(await startAttempt(pool(),student,assignment.id)).id;
    image=await sharp({create:{width:600,height:400,channels:3,background:'#fff'}}).jpeg().toBuffer();
    await finish(1,'29','由二次公式求出判别式，数据已核算并完成独立检查。');
    await finish(2,'chlorophyll','根据题目定义，物质名称已经识别，解释保留在这里。','short-answer');
    await finish(3,'-3/2','由计算得到负分数。','numeric',false);
    await finish(4,'','由面积公式计算。\n\n' + String.raw`**结果：$\frac{5}{3}$**`,'short-answer');
    await finish(5,'7','原始模型答案是7。');
    const manual=(await snapshot(pool(),student,attemptId)).slots[4];if(!manual)throw new Error('NO_MANUAL_SLOT');
    await teacherConfirm(pool(),admin,manual.id,{requestId:randomUUID(),expectedRevision:manual.revision,expectedRunId:manual.runId,expectedReviewId:manual.reviewId,selectedOptions:null,answer:'41',note:'合成人工修正，不能沿用原始数值。'});
    await finish(6,'', '这是一段需要完整阅读的论述。'.repeat(15),'essay');
    await finish(7,'7','用于验证重拍版本的原始答案。');
    await finish(8,'[test](https://example.invalid)','模型数值字段作为纯文本展示。','short-answer');
    service=createExamService({pool:pool(),storage,origin:'http://127.0.0.1:3190',publicDir:join(process.cwd(),'apps/exam-web/dist/public'),clientAddress:()=>randomUUID()});
    const started=serve({hostname:'127.0.0.1',port:0,fetch:req=>service.app.fetch(req)});if(!(started instanceof Server))throw new Error('NO_SERVER');server=started;
    await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('NO_PORT');origin='http://127.0.0.1:'+address.port;
    service=createExamService({pool:pool(),storage,origin,publicDir:join(process.cwd(),'apps/exam-web/dist/public'),clientAddress:()=>randomUUID()});
  });
  afterAll(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await db?.close();if(root)await rm(root,{recursive:true,force:true});});
  it('adds values only for an explicit capability, from the current published AI answer',async()=>{
    const legacy=await snapshot(pool(),student,attemptId),value=await snapshot(pool(),student,attemptId,{answerValues:true});
    expect(legacy.slots[0]?.presentation).not.toHaveProperty('responseValue');
    expect(value.slots[0]?.presentation).toMatchObject({responseValue:'29',verified:true});
    expect(value.slots[1]?.presentation?.responseValue).toBe('chlorophyll');
    expect(value.slots[2]?.presentation).toMatchObject({responseValue:'-3/2',verified:false});
    expect(value.slots[4]?.presentation).toMatchObject({answer:'41',humanConfirmed:true});
    expect(value.slots[4]?.presentation).not.toHaveProperty('responseValue');
    expect(value.slots[5]?.presentation).not.toHaveProperty('responseValue');
  });
  it('retains legacy HTTP shape and owner checks with the capability header',async()=>{
    const cookie=async(username:string)=>{const r=await service.app.request(origin+'/api/v2/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password:'synthetic-password-123'})});expect(r.status).toBe(200);return r.headers.get('set-cookie')?.split(';')[0]??'';};
    const own=await cookie(student.username),other=await cookie(outsider.username),path=origin+'/api/v2/attempts/'+attemptId+'/snapshot';
    const legacy=ExamAttemptSchema.parse(await(await service.app.request(path,{headers:{cookie:own}})).json());expect(legacy.slots[0]?.presentation).not.toHaveProperty('responseValue');
    const current=ExamAttemptSchema.parse(await(await service.app.request(path,{headers:{cookie:own,...header}})).json());expect(current.slots[0]?.presentation?.responseValue).toBe('29');
    expect((await service.app.request(path,{headers:{cookie:other,...header}})).status).toBe(404);
  });
  for(const engine of ['chrome','webkit']as const)it(`shows numeric and text values in the answer and overview in ${engine}`,async()=>{
    const state=await snapshot(pool(),student,attemptId),first=state.slots[0];if(!first)throw new Error('NO_FIRST');
    await navigateAttempt(pool(),student,attemptId,{requestId:randomUUID(),expectedVersion:state.navigationVersion,action:'select_slot',slotId:first.id});
    const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch()),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(5000);
    try{
      expect((await context.request.post(origin+'/api/v2/auth/login',{headers:{origin},data:{username:student.username,password:'synthetic-password-123'}})).status()).toBe(200);
      await page.goto(origin);const answer=page.locator('.current-answer'),fill=answer.locator('.answer-fill');
      await browserExpect(fill).toHaveText('29');await browserExpect(answer).toContainText('由二次公式');
      const screenshots=join(process.cwd(),'.runtime/nonchoice-answer-20261107/screens');await mkdir(screenshots,{recursive:true});
      for(const width of [320,390,1280])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        expect(await fill.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(theme==='light'?'rgb(239, 249, 244)':'rgb(21, 44, 37)');
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:join(screenshots,`answer-${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
      }
      await page.getByRole('button',{name:'总览',exact:true}).click();const overview=page.getByRole('region',{name:'本节答案总览'});
      await browserExpect(overview.getByRole('button',{name:'第1题',exact:true}).locator('.section-answer-value')).toHaveText('29');
      await browserExpect(overview.getByRole('button',{name:'第2题',exact:true}).locator('.section-answer-value')).toHaveText('chlorophyll');
      await browserExpect(overview.getByRole('button',{name:'第5题',exact:true}).locator('.section-answer-value')).toHaveText('41');
      await browserExpect(overview.getByRole('button',{name:'第6题',exact:true}).locator('.section-answer-value')).toHaveText('查看答案');
      expect(await overview.getByRole('button',{name:'第1题',exact:true}).getAttribute('aria-current')).toBe('step');
      expect(await overview.getByRole('link').count()).toBe(0);
      const described = await overview.getByRole('button',{name:'第1题',exact:true}).getAttribute('aria-describedby');expect(described).toContain('-answer ');
      for(const width of [320,390,1280])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:join(screenshots,`overview-${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
      }
      await overview.getByRole('button',{name:'第3题',exact:true}).click();await browserExpect(fill).toHaveText('-3/2');expect(await fill.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(50, 42, 29)');
      await page.getByRole('button',{name:'下一题',exact:true}).click();await answer.locator('.answer-fill .katex').waitFor();
      await page.getByRole('button',{name:'下一题',exact:true}).click();await browserExpect(fill).toHaveText('41');
      await page.getByRole('button',{name:'总览',exact:true}).click();await overview.getByRole('button',{name:'第8题',exact:true}).click();await browserExpect(fill).toHaveText('[test](https://example.invalid)');expect(await fill.getByRole('link').count()).toBe(0);
      expect(errors).toEqual([]);
    }finally{await context.close();await browser.close();}
  },35000);
  for(const engine of ['chrome','webkit']as const)it(`teacher summary matches student values without reusing the old AI value after manual review in ${engine}`,async()=>{
    const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch()),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors:string[]=[];
    page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
    try{
      expect((await context.request.post(origin+'/api/v2/auth/login',{headers:{origin},data:{username:admin.username,password:'synthetic-password-123'}})).status()).toBe(200);
      await page.goto(origin);await page.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:'实时跟踪',exact:true}).click();
      await page.getByRole('row').filter({hasText:student.displayName}).getByRole('button',{name:'查看',exact:true}).click();
      const monitor=page.getByRole('dialog',{name:student.displayName,exact:true});await monitor.getByRole('button',{name:'数学 · 第1题',exact:true}).click();
      const summary=monitor.locator('.review-current-answer');await browserExpect(summary.locator('.answer-fill')).toHaveText('29');
      const screenshots=join(process.cwd(),'.runtime/platform-audit-20261107/screens');await mkdir(screenshots,{recursive:true});
      for(const width of [320,390,1440])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        expect(await summary.locator('.answer-fill').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(theme==='light'?'rgb(239, 249, 244)':'rgb(21, 44, 37)');
        await page.screenshot({path:join(screenshots,`teacher-answer-${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
        await summary.scrollIntoViewIfNeeded();await page.screenshot({path:join(screenshots,`teacher-value-${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
      }
      await monitor.getByRole('button',{name:'数学 · 第5题',exact:true}).click();await browserExpect(summary.locator('.answer-fill')).toHaveText('41');await browserExpect(summary).toContainText('老师已确认');
      await monitor.getByRole('button',{name:'数学 · 第3题',exact:true}).click();await browserExpect(summary.locator('.answer-fill')).toHaveText('-3/2');expect(await summary.locator('.answer-fill').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(50, 42, 29)');
      expect(errors).toEqual([]);
    }finally{await context.close();await browser.close();}
  },30000);
  it('never carries a structured value from a replaced material/run into a new answer',async()=>{
    const old=(await snapshot(pool(),student,attemptId,{answerValues:true})).slots[6];if(!old)throw new Error('NO_RETAKE_SLOT');expect(old.presentation?.responseValue).toBe('7');
    await finish(7,'42','新材料上的答案。');
    const updated=(await snapshot(pool(),student,attemptId,{answerValues:true})).slots[6];expect(updated?.revision).toBe(2);expect(updated?.presentation?.responseValue).toBe('42');
  });
});
