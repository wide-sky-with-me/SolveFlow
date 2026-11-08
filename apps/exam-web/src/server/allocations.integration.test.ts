import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { chromium, webkit, expect as browserExpect } from '@playwright/test';
import { build } from 'esbuild';
import sharp from 'sharp';
import { addSittingStudents, allocationPage, bootstrap, claimJob, connectDatabase, createTemplate, createUser, finishJob, migrate, publishSitting, snapshot, startAttempt, submit, teacherConfirm, updateAllocationStaff, updateAllocationState, updateUser } from '@solveflow/db';
import type { ExamUser } from '@solveflow/contracts/managed-exam';
import { SolveOutcomeSchema } from '@solveflow/contracts/agent';
import { createExamService, hashPassword } from './service.js';
import { LocalExamStorage } from './storage.js';
import { upload } from './images.js';
const url=process.env.SOLVEFLOW_EXAM_TEST_DATABASE_URL;
if(url&&(new URL(url).hostname!=='127.0.0.1'||!/^\/solveflow_exam_test_[a-f0-9]{12}$/.test(new URL(url).pathname)))throw new Error('ISOLATED_DATABASE_REQUIRED');
const db=url?connectDatabase(url):null;function pool(){if(!db)throw new Error('NO_DATABASE');return db.pool;}
let admin:ExamUser,manager:ExamUser,foreign:ExamUser,a:ExamUser,b:ExamUser,c:ExamUser,t1:ExamUser,t2:ExamUser,disabled:ExamUser;
let templateId='',password='',root='',origin='',storage:LocalExamStorage,image:Buffer,service:ReturnType<typeof createExamService>,server:ReturnType<typeof serve>;
const pending = new Set<Promise<unknown>>();
const settings=()=>({supportIds:[t1.id,t2.id],mode:'original' as const,wrongCounts:[]});
const publish=(students:ExamUser[],actor=admin,title='合成分配 '+randomUUID())=>publishSitting(pool(),actor,{requestId:randomUUID(),sitting:{templateId,title,opensAt:new Date(Date.now()-60000).toISOString(),closesAt:null},studentIds:students.map(s=>s.id),...settings()});
const user=async(username:string,roles:ExamUser['roles'],actor=admin)=>createUser(pool(),actor,{username,displayName:username,password:'synthetic-password-123',roles},password);
const outcome=()=>SolveOutcomeSchema.parse({schemaVersion:1,status:'completed',verificationStatus:'not_requested',verified:false,verification:null,warning:null,candidate:{schemaVersion:1,kind:'answer',problem:{text:'What is 2 + 2?',subject:'math',uncertainties:[],options:[{label:'A',text:'3'},{label:'B',text:'4'}]},selectedOptions:['B'],answer:'B. 4',steps:[],knowledgePoints:[],citationIds:[],clarificationQuestions:[]}});
describe.skipIf(!url)('atomic sitting publishing and allocation editing',()=>{
 beforeAll(async()=>{
  await migrate(pool());password=await hashPassword('synthetic-password-123');admin=await bootstrap(pool(),'admin','测试管理员',password);
  manager=await user('manager',['manager']);foreign=await user('foreign',['manager']);
  a=await user('student_a',['student']);b=await user('student_b',['student']);c=await user('student_c',['student']);
  t1=await user('teacher_a',['support']);t2=await user('teacher_b',['support']);disabled=await user('disabled',['support']);
  await updateUser(pool(),admin,disabled.id,{displayName:disabled.displayName,state:'disabled',roles:['support']},undefined);
  for(let i=0;i<23;i++)await user('page_teacher_'+String(i).padStart(2,'0'),['support']);
  templateId=(await createTemplate(pool(),admin,{code:'allocation-test',title:'分配合成模板',exam:'sat',modules:[{code:'m1',sectionCode:'math',title:'数学模块',questionCount:2,durationSeconds:null}]})).id;
  root=await mkdtemp(join(tmpdir(),'solveflow-allocations-'));storage=new LocalExamStorage(join(root,'media'));
  image=await sharp({create:{width:300,height:200,channels:3,background:'#fff'}}).png().toBuffer();
  const built=await build({entryPoints:['src/browser/main.tsx'],absWorkingDir:join(process.cwd(),'apps/exam-web'),outdir:root,bundle:true,platform:'browser',jsx:'automatic',format:'esm',loader:{'.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},write:false});
  for(const f of built.outputFiles)await writeFile(f.path,f.contents);
  await writeFile(join(root,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/main.css"><div id="root"></div><script type="module" src="/main.js"></script>');
  server=serve({hostname:'127.0.0.1',port:0,fetch:req=>service.app.fetch(req)});await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('NO_PORT');origin='http://127.0.0.1:'+address.port;
  service=createExamService({pool:pool(),storage,origin,publicDir:root,clientAddress:()=> 'allocation-tests'});
 },30000);
 afterAll(async()=>{await Promise.allSettled(pending);if(server instanceof Server)server.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await db?.close();if(root)await rm(root,{recursive:true,force:true});});
 it('publishes all students and multiple teachers atomically and replays one receipt',async()=>{
  const input={requestId:randomUUID(),sitting:{templateId,title:'原子创建',opensAt:new Date(Date.now()-10000).toISOString(),closesAt:null},studentIds:[a.id,b.id],...settings()};
  const [one,two]=await Promise.all([publishSitting(pool(),admin,input),publishSitting(pool(),admin,input)]);expect(two.id).toBe(one.id);
  const page=await allocationPage(pool(),admin,one.id,{});expect(page.total).toBe(2);expect(page.items.every(item=>item.support.length===2)).toBe(true);expect(new Set(page.items.map(item=>item.student.id))).toEqual(new Set([a.id,b.id]));
  await expect(publishSitting(pool(),admin,{...input,studentIds:[a.id]})).rejects.toMatchObject({status:409});
  const before=(await pool().query('SELECT count(*)::integer n FROM exam_app.exam_sittings')).rows[0].n;
  await expect(publishSitting(pool(),admin,{...input,requestId:randomUUID(),supportIds:[disabled.id]})).rejects.toMatchObject({status:409});
  await expect(publishSitting(pool(),manager,{...input,requestId:randomUUID()})).rejects.toMatchObject({status:404});
  expect((await pool().query('SELECT count(*)::integer n FROM exam_app.exam_sittings')).rows[0].n).toBe(before);
 });
 it('adds students without leaving partial allocations on duplicate input',async()=>{
  const sitting=await publish([a]);
  await expect(addSittingStudents(pool(),admin,sitting.id,{requestId:randomUUID(),studentIds:[b.id,a.id],...settings()})).rejects.toMatchObject({code:'23505'});
  expect((await allocationPage(pool(),admin,sitting.id,{})).total).toBe(1);
  const input={requestId:randomUUID(),studentIds:[b.id],...settings()};await addSittingStudents(pool(),admin,sitting.id,input);await addSittingStudents(pool(),admin,sitting.id,input);
  expect((await allocationPage(pool(),admin,sitting.id,{})).total).toBe(2);
 });
 it('scopes allocation pages, escapes search and normalizes the last page',async()=>{
  const children=[];for(let i=0;i<25;i++)children.push(await user('page_student_'+i,['student'],manager));
  const sitting=await publish(children,manager);const page=await allocationPage(pool(),manager,sitting.id,{page:99,pageSize:20});expect(page.page).toBe(2);expect(page.total).toBe(25);expect(page.items).toHaveLength(5);
  expect((await allocationPage(pool(),manager,sitting.id,{q:'%'})).total).toBe(0);
  for(const actor of [foreign,t1,a])await expect(allocationPage(pool(),actor,sitting.id,{})).rejects.toMatchObject({status:404});
 });
 it('updates teachers during queued answering without changing the question or timer',async()=>{
  const sitting=await publish([c]),item=(await allocationPage(pool(),admin,sitting.id,{})).items[0];if(!item)throw new Error('NO_ALLOCATION');
  const attempt=await startAttempt(pool(),c,item.id),before=await snapshot(pool(),c,attempt.id),slot=before.slots[0];if(!slot)throw new Error('NO_SLOT');
  const asset=await upload(pool(),storage,c,slot.id,randomUUID(),image);const run=await submit(pool(),c,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[asset.id]});
  await updateAllocationStaff(pool(),admin,sitting.id,item.id,{requestId:randomUUID(),expectedVersion:item.version,supportIds:[t2.id]});
  const after=await snapshot(pool(),c,attempt.id);expect(after.timing.startedAt).toBe(before.timing.startedAt);expect(after.slots[0]?.runId).toBe(run.runId);expect(after.slots[0]?.status).toBe('queued');
  await expect(snapshot(pool(),t1,attempt.id)).rejects.toMatchObject({status:404});expect((await snapshot(pool(),t2,attempt.id)).id).toBe(attempt.id);
  await expect(updateAllocationStaff(pool(),admin,sitting.id,item.id,{requestId:randomUUID(),expectedVersion:item.version,supportIds:[t1.id]})).rejects.toMatchObject({status:409});
  await expect(updateAllocationState(pool(),admin,sitting.id,item.id,{requestId:randomUUID(),expectedVersion:item.version+1,action:'revoke'})).rejects.toMatchObject({status:409});
  const job=await claimJob(pool());if(!job)throw new Error('NO_JOB');await finishJob(pool(),job,outcome(),null);
 });
 it('rechecks teacher permission after waiting behind a reassignment',async()=>{
  const child=await user('concurrent_student',['student']),sitting=await publish([child]);
  const item=(await allocationPage(pool(),admin,sitting.id,{})).items[0];if(!item)throw new Error('NO_ALLOCATION');
  const attempt=await startAttempt(pool(),child,item.id),slot=(await snapshot(pool(),child,attempt.id)).slots[0];if(!slot)throw new Error('NO_SLOT');
  const asset=await upload(pool(),storage,child,slot.id,randomUUID(),image);const run=await submit(pool(),child,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[asset.id]});
  const job=await claimJob(pool());if(!job)throw new Error('NO_JOB');await finishJob(pool(),job,outcome(),null);
  const blocker=await pool().connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE',[attempt.id]);
  try{
   const grant=updateAllocationStaff(pool(),admin,sitting.id,item.id,{requestId:randomUUID(),expectedVersion:item.version,supportIds:[t2.id]});pending.add(grant);
   await expect.poll(async()=>Number((await pool().query("SELECT count(*) n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%WHERE assignment_id=$1 ORDER BY id FOR UPDATE%'")).rows[0].n)).toBe(1);
   const review=teacherConfirm(pool(),t1,slot.id,{requestId:randomUUID(),expectedRevision:1,expectedRunId:run.runId,expectedReviewId:null,answer:'B. 4',selectedOptions:['B'],note:'已检查合成题。'}).then(()=>({status:200}),error=>({status:typeof error==='object'&&error&&'status'in error?error.status:0}));pending.add(review);
   await expect.poll(async()=>Number((await pool().query("SELECT count(*) n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query='SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE'")).rows[0].n)).toBe(1);
   await blocker.query('COMMIT');await grant;expect((await review).status).toBe(404);
   expect((await snapshot(pool(),child,attempt.id)).slots[0]?.reviewId).toBeNull();
  }finally{await blocker.query('ROLLBACK');blocker.release();}
 });
 it('preserves an unstarted allocation across remove and restore',async()=>{
  const sitting=await publish([a]),item=(await allocationPage(pool(),admin,sitting.id,{})).items[0];if(!item)throw new Error('NO_ALLOCATION');
  const input={requestId:randomUUID(),expectedVersion:item.version,action:'revoke'};await updateAllocationState(pool(),admin,sitting.id,item.id,input);await updateAllocationState(pool(),admin,sitting.id,item.id,input);
  await expect(startAttempt(pool(),a,item.id)).rejects.toMatchObject({status:409});
  const removed=(await allocationPage(pool(),admin,sitting.id,{})).items[0];expect(removed?.state).toBe('revoked');expect(removed?.support).toHaveLength(2);
  await updateAllocationState(pool(),admin,sitting.id,item.id,{requestId:randomUUID(),expectedVersion:item.version+1,action:'restore'});
  expect((await startAttempt(pool(),a,item.id)).id).toBeTruthy();
 });
 for(const engine of ['chrome','webkit'] as const)it('keeps publishing and adjustments compact and functional in '+engine,async()=>{
  const pupil1=await user('ui_one_'+engine,['student']),pupil2=await user('ui_two_'+engine,['student']),pupil3=await user('ui_three_'+engine,['student']);
  const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const screenshots='.runtime/exam-allocations';await mkdir(screenshots,{recursive:true});
  try{
   await page.goto(origin);await page.getByLabel('用户名',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('synthetic-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();
   await page.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:'考试安排',exact:true}).click();
   expect(await page.getByRole('button',{name:'分配学生',exact:true}).count()).toBe(0);
   const toolbar=page.getByRole('region',{name:'场次与具体考试'}).locator('.event-list-tools');await toolbar.getByRole('button',{name:'新建场次',exact:true}).waitFor();
   const searchBox=await toolbar.getByRole('searchbox').boundingBox(),createBox=await toolbar.getByRole('button',{name:'新建场次',exact:true}).boundingBox();if(!searchBox||!createBox)throw new Error('MISSING_TOOLBAR');expect(createBox.x).toBeGreaterThan(searchBox.x+searchBox.width-1);
   await page.screenshot({path:screenshots+'/toolbar-'+engine+'.png',fullPage:true});await toolbar.getByRole('button',{name:'新建场次',exact:true}).click();
   let dialog=page.getByRole('dialog');const title='界面发布 '+engine;await dialog.getByLabel('场次名称').fill(title);await dialog.getByRole('button',{name:'保存场次',exact:true}).click();await page.getByRole('article',{name:title,exact:true}).getByRole('button',{name:'查看考试',exact:true}).click();await page.getByRole('button',{name:'新建具体考试',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('考试名称',{exact:true}).fill(title);await dialog.getByRole('combobox',{name:'考试时间',exact:true}).click();await page.getByRole('option',{name:'不限时间',exact:true}).click();
   await dialog.getByRole('combobox',{name:'学生',exact:true}).click();
   for(const pupil of [pupil1,pupil2]){const input=dialog.getByRole('searchbox',{name:'搜索学生',exact:true});await input.fill(pupil.username);await input.press('Enter');await dialog.getByRole('option',{name:new RegExp(pupil.username)}).click();}
   expect(await dialog.locator('select[name=studentIds] option:checked').count()).toBe(2);await page.keyboard.press('Escape');
   await dialog.getByRole('combobox',{name:'负责老师',exact:true}).click();await browserExpect(dialog.getByRole('option').first()).toBeVisible();await dialog.getByRole('option').first().click();await dialog.getByRole('button',{name:'下一页',exact:true}).click();await browserExpect(dialog.locator('.select-options .page-position')).toHaveText('第 2 / 2 页');await dialog.getByRole('option').first().click();
   expect(await dialog.locator('select[name=supportIds] option:checked').count()).toBe(2);await page.screenshot({path:screenshots+'/teachers-'+engine+'.png',fullPage:true});await page.keyboard.press('Escape');
   await page.screenshot({path:screenshots+'/publish-'+engine+'.png',fullPage:true});await dialog.getByRole('button',{name:'保存考试',exact:true}).click();await browserExpect(page.getByRole('dialog')).toHaveCount(0);
   const row=page.getByRole('article',{name:title,exact:true});await browserExpect(row).toContainText('2 位学生');await row.getByRole('button',{name:'人员与错题配置',exact:true}).click();dialog=page.getByRole('dialog');await browserExpect(dialog.locator('tbody tr')).toHaveCount(2);
   await dialog.locator('tbody tr').first().getByRole('button',{name:'调整',exact:true}).click();await dialog.getByRole('combobox',{name:'负责老师',exact:true}).click();const selected=dialog.getByRole('option',{selected:true});await browserExpect(selected).toHaveCount(2);await selected.first().click();await page.screenshot({path:screenshots+'/edit-teachers-'+engine+'.png',fullPage:true});await page.keyboard.press('Escape');await dialog.getByRole('button',{name:'保存',exact:true}).click();await browserExpect(dialog.locator('tbody tr')).toHaveCount(2);
   await dialog.getByRole('button',{name:'添加学生',exact:true}).click();await dialog.getByRole('combobox',{name:'学生',exact:true}).click();const query=dialog.getByRole('searchbox',{name:'搜索学生',exact:true});await query.fill(pupil3.username);await query.press('Enter');await dialog.getByRole('option',{name:new RegExp(pupil3.username)}).click();await page.keyboard.press('Escape');await dialog.getByRole('button',{name:'保存',exact:true}).click();await browserExpect(dialog.locator('tbody tr')).toHaveCount(3);
   const extraRow=dialog.getByRole('row').filter({hasText:pupil3.username});await extraRow.getByRole('button',{name:'移除',exact:true}).click();await page.getByRole('dialog',{name:'移除分配？',exact:true}).getByRole('button',{name:'取消',exact:true}).click();await extraRow.getByRole('button',{name:'移除',exact:true}).click();await page.getByRole('dialog',{name:'移除分配？',exact:true}).getByRole('button',{name:'确认移除',exact:true}).click();await browserExpect(extraRow).toContainText('已移除');await extraRow.getByRole('button',{name:'恢复',exact:true}).click();await browserExpect(extraRow).toContainText('已分配');
   for(const width of [390,320]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:screenshots+'/manage-'+engine+'-'+width+'.png',fullPage:true});}
   await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:screenshots+'/manage-dark-'+engine+'.png',fullPage:true});expect(errors).toEqual([]);
  }catch(error){await page.screenshot({path:screenshots+'/failure-'+engine+'.png',fullPage:true});throw error;}finally{await browser.close();}
 },60000);
});
