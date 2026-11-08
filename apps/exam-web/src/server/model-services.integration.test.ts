import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Server } from 'node:http';
import { chromium, webkit } from '@playwright/test';
import { z } from 'zod';
import sharp from 'sharp';
import { bootstrap, claimJob, connectDatabase, createAssignment, createSitting, createTemplate, createUser, finishJob, migrate, modelServiceVersion, modelServiceVersions, selectModelService, snapshot, startAttempt, studentRun, submit, teacherRun, userById, userModelService, updateUser } from '@solveflow/db';
import { WebStoredModelsSchema } from '@solveflow/contracts/local';
import { ExamModelServiceAdminSchema, ExamModelServiceSelectionSchema, ExamModelServicesAdminSchema } from '@solveflow/contracts/exam-model-services';
import { SolveOutcomeSchema } from '@solveflow/contracts/agent';
import type { ExamUser } from '@solveflow/contracts/managed-exam';
import { ModelServices } from './model-services.js';
import { createExamService, hashPassword } from './service.js';
import { LocalExamStorage } from './storage.js';
import { PracticeJobs, type PracticeSolve } from './practice.js';

const url=process.env.SOLVEFLOW_EXAM_TEST_DATABASE_URL;
if(url&&(new URL(url).hostname!=='127.0.0.1'||!/^\/solveflow_exam_test_[a-f0-9]{12}$/.test(new URL(url).pathname)))throw new Error('ISOLATED_DATABASE_REQUIRED');
const db=url?connectDatabase(url):null;
function pool(){if(!db)throw new Error('NO_TEST_DATABASE');return db.pool;}
const password='synthetic-password-123';
function models(label: string) {
    const profile={provider:'openai',baseURL:'https://'+label+'.example/v1',model:label+'-model',api:'openai-completions',contextWindow:32768,maxTokens:8192,maxTokensField:'max_tokens',streaming:false};
    return WebStoredModelsSchema.parse({schemaVersion:1,models:{solver:profile,verifier:profile,backup:null},keys:{solver:'synthetic-'+label+'-solver',verifier:'synthetic-'+label+'-verifier',backup:null}});
}
const result=()=>SolveOutcomeSchema.parse({schemaVersion:1,status:'completed',verified:false,verificationStatus:'not_requested',verification:null,warning:null,candidate:{schemaVersion:1,kind:'answer',problem:{text:'What is 2 + 2?',subject:'math',uncertainties:[],options:[{label:'A',text:'3'},{label:'B',text:'4'}]},selectedOptions:['B'],answer:'B. 4',steps:[],knowledgePoints:[],citationIds:[],clarificationQuestions:[]}});
let root='',origin='',server:ReturnType<typeof serve>,service:ReturnType<typeof createExamService>,registry:ModelServices,practice:PracticeJobs;
let admin:ExamUser,teacher:ExamUser,manager:ExamUser,student:ExamUser,other:ExamUser,hash='',sittingId='';
const master=randomBytes(32).toString('hex'),primary=models('primary'),backup=models('secondary');
const checks: {url:string;authorization:string|null}[]=[],practiceRefs:Parameters<PracticeSolve>[0]['modelService'][]=[];
async function request(path:string,cookie='',method='GET',body?:unknown){return service.app.request('/api/v2'+path,{method,headers:{origin,cookie,...body===undefined?{}:{'content-type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}});}
async function login(username:string){const response=await request('/auth/login','','POST',{username,password});expect(response.status).toBe(200);return response.headers.get('set-cookie')?.split(';')[0]??'';}
async function saved(code:'primary'|'backup'){const row=(await registry.list(admin)).find(row=>row.code===code);if(!row)throw new Error('NO_SERVICE_ROW');return row;}
async function enqueue(owner:ExamUser){
    const assignment=await createAssignment(pool(),admin,{sittingId,studentId:owner.id});const attempt=await startAttempt(pool(),owner,assignment.id),slot=(await snapshot(pool(),owner,attempt.id)).slots[0];if(!slot)throw new Error('NO_SLOT');
    const assetId=randomUUID();await pool().query("INSERT INTO exam_app.media_assets(id,owner_user_id,object_key,variant,mime_type,byte_size,width,height,sha256,state,retention_until) VALUES($1,$2,$3,'model','image/jpeg',12,10,10,$4,'ready',now()+interval '1 day')",[assetId,owner.id,'synthetic/'+assetId,'b'.repeat(64)]);
    const run=await submit(pool(),owner,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[assetId]});return {run,slot,attempt};
}
describe.skipIf(!url)('managed model services',()=>{
    beforeAll(async()=>{
        await migrate(pool());hash=await hashPassword(password);admin=await bootstrap(pool(),'admin','管理员',hash);
        const create=(username:string,roles:ExamUser['roles'])=>createUser(pool(),admin,{username,displayName:username,password,roles},hash);
        teacher=await create('teacher',['support']);manager=await create('manager',['manager']);student=await create('student',['student']);other=await create('other',['student']);
        const template=await createTemplate(pool(),admin,{code:'model-test',title:'服务方案合成考试',exam:'general',modules:[{code:'math',title:'数学',sectionCode:'math',questionCount:2,durationSeconds:null,subject:'math'}]});
        sittingId=(await createSitting(pool(),admin,{templateId:template.id,title:'服务方案合成场次',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:null})).id;
        registry=new ModelServices(pool(),master,primary,backup,[],async(input,init)=>{checks.push({url:String(input),authorization:new Headers(init?.headers).get('authorization')});return new Response(JSON.stringify({data:[{id:'primary-model'},{id:'secondary-model'}]}),{headers:{'content-type':'application/json'}});});await registry.initialize();
        root=await mkdtemp(join(tmpdir(),'solveflow-model-services-'));await mkdir(join(root,'media'));
        practice=new PracticeJobs(async input=>{practiceRefs.push(input.modelService);return result();},Date.now,4,owner=>registry.capture(owner));
        server=serve({hostname:'127.0.0.1',port:0,fetch:req=>service.app.fetch(req)});await new Promise<void>(resolve=>server.once('listening',()=>resolve()));const address=server.address();if(!address||typeof address==='string')throw new Error('NO_TEST_PORT');origin='http://127.0.0.1:'+address.port;
        service=createExamService({pool:pool(),origin,publicDir:join(process.cwd(),'apps/exam-web/dist/public'),storage:new LocalExamStorage(join(root,'media')),modelServices:registry,practice,clientAddress:()=>randomUUID()});
    },30000);
    afterAll(async()=>{practice?.close();if(server instanceof Server)server.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await db?.close();if(root)await rm(root,{recursive:true,force:true});});
    it('exposes only two names to students and denies teacher/manager configuration access',async()=>{
        expect((await request('/me/model-service')).status).toBe(401);
        const cookie=await login('student'),response=await request('/me/model-service',cookie),text=await response.text(),data=ExamModelServiceSelectionSchema.parse(JSON.parse(text));
        expect(data).toMatchObject({selected:'primary',version:0});expect(data.services).toHaveLength(2);expect(text).not.toMatch(/https|synthetic-|keys|model_name|baseURL|contextWindow/);
        for(const username of ['student','teacher','manager']){const identity=await login(username);expect((await request('/admin/model-services',identity)).status).toBe(404);expect((await request('/admin/model-services/primary',identity,'POST',{expectedVersion:1,name:'非法',enabled:false,models:null,keys:{solver:null,verifier:null,backup:null}})).status).toBe(404);}
        const details=await request('/admin/model-services',await login('admin'));const raw=await details.text();expect(ExamModelServicesAdminSchema.parse(JSON.parse(raw))[0]?.hasKeys.solver).toBe(true);expect(raw).not.toContain('synthetic-primary-solver');expect(raw).not.toContain('ciphertext');
        expect((await request('/me/model-service',cookie,'POST',{code:'backup',expectedVersion:0,models:primary.models})).status).toBe(400);
    });
    it('persists isolated student choices with conflict detection and harmless repeated selection',async()=>{
        const cookie=await login('student');expect((await request('/me/model-service',cookie,'POST',{code:'backup',expectedVersion:0})).status).toBe(200);
        expect((await registry.selection(student)).selected).toBe('backup');expect((await registry.selection(other)).selected).toBe('primary');
        expect((await request('/me/model-service',cookie,'POST',{code:'backup',expectedVersion:0})).status).toBe(200);expect((await request('/me/model-service',cookie,'POST',{code:'primary',expectedVersion:0})).status).toBe(409);
        const again=new ModelServices(pool(),master,primary,backup);await again.initialize();expect((await again.selection(student)).selected).toBe('backup');
        const current=await userModelService(pool(),student.id);await selectModelService(pool(),student,'primary',current.version);
    });
    it('encrypts credentials, preserves same-destination keys and rejects endpoint changes without replacement keys',async()=>{
        const before=await saved('primary'),input={expectedVersion:before.version,name:before.name,enabled:true,models:before.models,keys:{solver:null,verifier:null,backup:null}};
        const cookie=await login('admin');const response=await request('/admin/model-services/primary',cookie,'POST',input);expect(response.status).toBe(200);const updated=ExamModelServiceAdminSchema.parse(await response.json());expect(updated.version).toBe(before.version+1);expect(updated.hasKeys).toMatchObject({solver:true,verifier:true});
        const row=await modelServiceVersion(pool(),{code:'primary',version:updated.version});expect(row.ciphertext).not.toContain('synthetic-');expect((await registry.resolve({code:'primary',version:updated.version})).keys.solver).toBe(primary.keys.solver);
        expect((await request('/admin/model-services/primary',cookie,'POST',input)).status).toBe(409);
        if(!updated.models)throw new Error('NO_UPDATED_MODELS');
        const changed={...updated.models,solver:{...updated.models.solver,baseURL:'https://api.apiyi.com/v1'}};
        expect((await request('/admin/model-services/primary',cookie,'POST',{...input,expectedVersion:updated.version,models:changed})).status).toBe(400);
        const denied={...updated.models,solver:{...updated.models.solver,baseURL:'https://127.0.0.1/v1'}};
        expect((await request('/admin/model-services/primary',cookie,'POST',{...input,expectedVersion:updated.version,models:denied,keys:{...input.keys,solver:'synthetic-replacement'}})).status).toBe(400);
        await expect(pool().query("UPDATE exam_app.model_service_versions SET name='tampered' WHERE code='primary' AND version=1")).rejects.toThrow();
        const bad=new ModelServices(pool(),'0'.repeat(64),primary,backup);await expect(bad.resolve({code:'primary',version:updated.version})).rejects.toMatchObject({status:503});await expect(bad.initialize()).rejects.toMatchObject({status:503});
        await pool().query("INSERT INTO exam_app.model_service_versions(code,version,name,enabled,ciphertext) VALUES('backup',999,'tampered',true,$1)",[row.ciphertext]);await expect(registry.resolve({code:'backup',version:999})).rejects.toMatchObject({status:503});
    });
    it('pins accepted jobs while later student choices and administrator edits affect only new jobs',async()=>{
        const owner=await createUser(pool(),admin,{username:'pinning',displayName:'合成学生',password,roles:['student']},hash),before=await saved('primary');const first=await enqueue(owner);
        const job=await claimJob(pool());expect(job?.id).toBe(first.run.runId);expect(job?.modelService).toEqual({code:'primary',version:before.version});if(!job)throw new Error('NO_PINNED_JOB');
        await registry.select(owner,'backup',0);if(!before.models)throw new Error('NO_OLD_MODELS');
        await registry.update(admin,'primary',{expectedVersion:before.version,name:before.name,enabled:true,models:{...before.models,solver:{...before.models.solver,model:'edited-model'}},keys:{solver:null,verifier:null,backup:null}});
        expect((await registry.resolve(job.modelService)).models.solver.model).toBe('primary-model');await finishJob(pool(),job,result(),null);
        const rerun=await studentRun(pool(),owner,first.slot.id,{requestId:randomUUID(),expectedRevision:1,expectedRunId:job.id,expectedReviewId:null});const retry=await claimJob(pool());expect(retry?.id).toBe(rerun.id);expect(retry?.modelService?.code).toBe('backup');if(!retry)throw new Error('NO_RETRY_JOB');await finishJob(pool(),retry,result(),null);
        const review=await teacherRun(pool(),admin,first.slot.id,{requestId:randomUUID(),expectedRevision:1,expectedRunId:retry.id,expectedReviewId:null,action:'solve'});const teacherJob=await claimJob(pool());expect(teacherJob?.id).toBe(review.id);expect(teacherJob?.modelService?.code).toBe('backup');if(!teacherJob)throw new Error('NO_TEACHER_JOB');await finishJob(pool(),teacherJob,result(),null);
    });
    it('does not silently reroute a disabled selection or restore old defaults on process restart',async()=>{
        const owner=await createUser(pool(),admin,{username:'disabled-plan',displayName:'合成学生',password,roles:['student']},hash);await registry.select(owner,'backup',0);const before=await saved('backup');
        await registry.update(admin,'backup',{expectedVersion:before.version,name:before.name,enabled:false,models:before.models,keys:{solver:null,verifier:null,backup:null}});
        await new ModelServices(pool(),master,primary,backup).initialize();expect((await registry.selection(owner)).services.find(x=>x.code==='backup')?.available).toBe(false);
        await expect(enqueue(owner)).rejects.toMatchObject({status:409});expect((await pool().query('SELECT 1 FROM exam_app.answer_runs WHERE student_id=$1',[owner.id])).rowCount).toBe(0);
        await expect(registry.select(owner,'backup',1)).rejects.toMatchObject({status:409});await registry.select(owner,'primary',1);
        const disabled=await saved('backup');await registry.update(admin,'backup',{expectedVersion:disabled.version,name:disabled.name,enabled:true,models:disabled.models,keys:{solver:null,verifier:null,backup:null}});
    });
    it('checks only approved model metadata with no prompt, and never discloses a saved key',async()=>{
        const row=await saved('backup');if(!row.models)throw new Error('NO_MODELS');const before=checks.length;
        const response=await request('/admin/model-services/backup/check',await login('admin'),'POST',{expectedVersion:row.version,role:'solver',profile:row.models.solver,key:null});expect(response.status).toBe(200);expect(await response.json()).toEqual({reachable:true,modelListed:true});
        expect(checks.length).toBe(before+1);expect(checks.at(-1)).toEqual({url:'https://secondary.example/v1/models',authorization:'Bearer synthetic-secondary-solver'});
        expect((await pool().query('SELECT count(*)::int AS n FROM exam_app.model_call_attempts')).rows[0]?.n).toBe(0);
        await expect(registry.network('https://unapproved.example/v1/chat/completions')).rejects.toThrow('MODEL_ORIGIN_NOT_ALLOWED');
    });
    it('serializes concurrent administrator saves without overwriting a newer configuration',async()=>{
        const before=await saved('backup');const input={expectedVersion:before.version,name:before.name,enabled:before.enabled,models:before.models,keys:{solver:null,verifier:null,backup:null}};
        const attempts=await Promise.allSettled([registry.update(admin,'backup',input),registry.update(admin,'backup',input)]);
        expect(attempts.filter(row=>row.status==='fulfilled')).toHaveLength(1);const rejected=attempts.find(row=>row.status==='rejected');expect(rejected?.status==='rejected'&&rejected.reason).toMatchObject({status:409});expect((await saved('backup')).version).toBe(before.version+1);
    });
    it('captures the selected service for transient practice and keeps question data out of persistence',async()=>{
        const image=await sharp({create:{width:32,height:32,channels:3,background:'#fff'}}).jpeg().toBuffer(),cookie=await login('other');await registry.select(other,'backup',0);
        const response=await service.app.request('/api/v2/practice',{method:'POST',headers:{origin,cookie,'content-type':'image/jpeg','x-request-id':randomUUID(),'x-exam-type':'general'},body:Uint8Array.from(image)});expect(response.status).toBe(202);
        expect(practiceRefs.at(-1)?.code).toBe('backup');const choice=await userModelService(pool(),other.id);await registry.select(other,'primary',choice.version);
        expect(practiceRefs.at(-1)?.code).toBe('backup');
        expect((await pool().query('SELECT count(*)::int AS n FROM exam_app.media_assets WHERE owner_user_id=$1',[other.id])).rows[0]?.n).toBe(0);
    });
    for(const engine of ['chrome','webkit'] as const) it('keeps student choice private and administrator controls consistent in '+engine,async()=>{
        const choice=await userModelService(pool(),other.id);if(choice.code!=='primary')await registry.select(other,'primary',choice.version);
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch()),page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
        const saves:number[]=[];page.on('response',response=>{if(response.url().endsWith('/api/v2/admin/model-services/primary')&&response.request().method()==='POST')saves.push(response.status());});
        const screens=join(process.cwd(),'.runtime/model-services-20261106/screens');await mkdir(screens,{recursive:true});
        try{
            await page.goto(origin);await page.getByLabel('用户名',{exact:true}).fill('other');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'服务方案',exact:true}).click();
            const dialog=page.getByRole('dialog',{name:'服务方案',exact:true});await dialog.getByRole('radio',{name:/备用服务/}).check();
            expect(await dialog.innerText()).not.toMatch(/https|secondary-model|primary-model|API Key|openai/);const radio=await dialog.getByRole('radio').first().boundingBox(),label=await dialog.locator('strong').first().boundingBox();expect(radio&&label&&radio.width<=20&&radio.height<=20&&radio.x<label.x).toBe(true);
            for(const width of [320,390,1440])for(const theme of ['light','dark']){await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:join(screens,`choice-${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});}
            await dialog.getByRole('button',{name:'切换方案',exact:true}).click();await dialog.waitFor({state:'hidden'});expect((await registry.selection(other)).selected).toBe('backup');
            await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'退出登录',exact:true}).click();await page.getByLabel('用户名',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
            await page.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:'服务配置',exact:true}).click();const settings=page.getByRole('region',{name:'模型服务配置',exact:true});await settings.getByLabel('供应商标识',{exact:true}).waitFor();
            expect(await settings.getByLabel('API Key',{exact:true}).inputValue()).toBe('');const enabled=await settings.getByRole('checkbox',{name:'允许学生选择',exact:true}).boundingBox();expect(enabled&&enabled.width<=20&&enabled.height<=20).toBe(true);await settings.locator('summary').getByText('高级参数',{exact:true}).click();await settings.getByLabel('输出上限',{exact:true}).fill('4096');
            await settings.getByLabel('模型名称',{exact:true}).fill('unsaved-primary-model');await settings.getByRole('group',{name:'服务配置',exact:true}).getByRole('button',{name:/备用服务/}).click();await settings.getByRole('group',{name:'服务配置',exact:true}).getByRole('button',{name:/主服务/}).click();expect(await settings.getByLabel('模型名称',{exact:true}).inputValue()).toBe('unsaved-primary-model');
            for(const width of [320,390,1440])for(const theme of ['light','dark']){await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:join(screens,`admin-${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});}
            await settings.getByRole('button',{name:'保存配置',exact:true}).click();await settings.getByText('已保存，后续新任务使用此配置。',{exact:true}).waitFor();expect((await saved('primary')).models?.solver.model).toBe('unsaved-primary-model');expect(await settings.getByLabel('API Key',{exact:true}).inputValue()).toBe('');expect(errors).toEqual([]);
        }catch(error){
            await page.screenshot({path:join(screens,`failure-${engine}.png`),fullPage:true,animations:'disabled'});
            await writeFile(join(screens,`failure-${engine}.json`),JSON.stringify({saves,alerts:await page.getByRole('alert').allTextContents(),model:await page.getByLabel('模型名称',{exact:true}).inputValue().catch(()=>null),context:await page.getByLabel('上下文容量',{exact:true}).inputValue().catch(()=>null),output:await page.getByLabel('输出上限',{exact:true}).inputValue().catch(()=>null)},null,2));
            throw error;
        }finally{await browser.close();}
    },30000);
});
