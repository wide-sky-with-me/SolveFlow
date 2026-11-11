import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, webkit, expect as browserExpect, type Page } from '@playwright/test';
import { ExamAttemptSchema } from '@solveflow/contracts/managed-exam';

let assets: {js: string; css: string; html: string};
const screens = join(process.cwd(), '.runtime/ui-polish-20261108/screens');
const entry = `import {useState} from 'react';import{createRoot}from'react-dom/client';
import{Dialog}from'@solveflow/web-ui/dialog';import{Feedback}from'@solveflow/web-ui/feedback';import{Select}from'@solveflow/web-ui/select';
import{Brand,ErrorText}from'./src/browser/components.tsx';import{AppearanceMenu}from'./src/browser/appearance.tsx';import{AccountMenu}from'./src/browser/account-menu.tsx';import{AnswerSummary}from'./src/browser/answer-summary.tsx';
import './src/browser/styles.css';import './src/browser/review.css';import './src/browser/console.css';import './src/browser/notifications.css';import './src/browser/student-flow.css';import './src/browser/exam-clock.css';import './src/browser/paging.css';import './src/browser/design.css';
function Preview(){const[open,setOpen]=useState(false),[sync,setSync]=useState(0),[question,setQuestion]=useState(1),[view,setView]=useState(0),[more,setMore]=useState(false),[formError,setFormError]=useState('');
return <><header className="header-bar"><div className="header"><Brand/><div className="toolbar header-tools"><AppearanceMenu/><AccountMenu name="合成学生" busy={false} onHistory={()=>setView(v=>v+1)} onLogout={()=>{}}/></div></div></header>
<main className="student-content"><div className="management-tabs" role="tablist" aria-label="预览视图"><button role="tab" aria-selected={view===0} onClick={()=>setView(0)}>考试</button><button role="tab" aria-selected={view===1} onClick={()=>setView(1)}>历史</button></div><div className="workspace-view" key={view}>
<nav className="module-steps" aria-label="考试模块">{(more?['英语','数学','阅读','科学','写作','附加模块']:['阅读与写作一','阅读与写作二','数学第一模块','数学第二模块']).map((title,i)=><button key={title} title={title} className={i===0?'selected':''}><span className="module-title">{title}</span></button>)}</nav>
<section className="card student-question"><div className="section-head"><h2>数学第一模块</h2><span className="badge green">AI 已核验</span></div><section className="current-answer" key={question}><h3>第{question}题答案</h3><AnswerSummary answer={{answer:'独立核验后得到最终结果。',responseValue:'29',selectedOptions:null,verified:true,simulated:false}}/></section><div className="question-paging"><button className="secondary" onClick={()=>setSync(v=>v+1)}>同步状态</button><button className="primary" onClick={()=>setQuestion(v=>v+1)}>下一题</button></div><output aria-label="同步次数">{sync}</output><button className="quiet" onClick={()=>setMore(v=>!v)}>切换更多模块</button></section>
<section className="card" aria-label="状态与操作"><div className="toolbar"><span className="badge blue">处理中</span><span className="badge amber">待核验</span><span className="badge red">待处理</span></div><Feedback tone="success">已完成核验</Feedback><Feedback tone="warning">等待核验</Feedback><Feedback tone="error">需要处理</Feedback><Feedback tone="info">处理中</Feedback><Select label="考试类型" defaultValue="sat" options={[{value:'sat',label:'SAT'},{value:'act',label:'ACT'}]}/><button className="primary" onClick={()=>setOpen(true)}>打开表单</button></section></div>
{open&&<Dialog title="编辑考试" notice={formError ? <ErrorText error={formError}/> : null} onClose={()=>setOpen(false)}><form onSubmit={e=>{e.preventDefault();setFormError('保存失败：请同步后重试。');}}>{Array.from({length:10},(_,i)=><label key={i}>字段{i+1}<input defaultValue={'合成内容 '+(i+1)}/></label>)}<button type="button" className="quiet" onClick={()=>setSync(v=>v+1)}>更新弹窗状态</button><output aria-label="弹窗同步次数">{sync}</output><div className="dialog-footer"><button type="button" onClick={()=>setOpen(false)}>取消</button><button className="primary" type="submit">保存</button></div></form></Dialog>}</main></>};createRoot(document.getElementById('root')).render(<Preview/>);`;
async function prepare(page: Page) {
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    document.addEventListener('animationstart',event=>{
      if(event.target instanceof HTMLElement&&event.target.matches('dialog')&&event.animationName===getComputedStyle(event.target).animationName) document.documentElement.dataset.overlayStarts=String(Number(document.documentElement.dataset.overlayStarts??0)+1);
      if(event.target instanceof HTMLElement&&event.target.matches('.current-answer')&&event.animationName===getComputedStyle(event.target).animationName) document.documentElement.dataset.answerStarts=String(Number(document.documentElement.dataset.answerStarts??0)+1);
    });
  });
  await page.route('http://127.0.0.1:3199/**',route=>{
    const path=new URL(route.request().url()).pathname;
    return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?assets.js:path==='/harness.css'?assets.css:assets.html});
  });
  await page.goto('http://127.0.0.1:3199/');await page.getByRole('heading',{name:'第1题答案',exact:true}).waitFor();
}
async function theme(page: Page, value: 'light'|'dark'|'system') {
  await page.evaluate(value=>window.dispatchEvent(new CustomEvent('exam-appearance',{detail:value})),value);
}
async function settle(page: Page) {await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
function contrast(foreground: string, background: string) {
  const luma=(color: string)=>{const rgb=color.match(/[\d.]+/g)?.slice(0,3).map(Number);if(!rgb||rgb.length!==3)throw new Error('OPAQUE_RGB_REQUIRED');return rgb.reduce((sum,v,i)=>{const s=v/255;return sum+(s<=.04045?s/12.92:((s+.055)/1.055)**2.4)*([.2126,.7152,.0722][i]??0);},0);};
  const a=luma(foreground),b=luma(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
describe('exam UI consistency and restrained motion',()=>{
  beforeAll(async()=>{
    await mkdir(screens,{recursive:true});
    const result=await build({stdin:{contents:entry,resolveDir:join(process.cwd(),'apps/exam-web'),loader:'tsx'},outfile:'harness.js',write:false,bundle:true,jsx:'automatic',format:'esm',platform:'browser',loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
    const js=result.outputFiles.find(f=>f.path.endsWith('.js'))?.text,css=result.outputFiles.find(f=>f.path.endsWith('.css'))?.text;if(!js||!css)throw new Error('MISSING_UI_ASSETS');
    assets={js,css,html:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/harness.css"><div id="root"></div><script type="module" src="/harness.js"></script>'};
  });
  for(const engine of ['chrome','webkit']as const){
    const launch=()=>engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch();
    it(`shares status colors, contrast and readable narrow layouts in ${engine}`,async()=>{
      const browser=await launch(),page=await browser.newPage({viewport:{width:390,height:844}});
      try{await prepare(page);
        for(const scheme of ['light','dark','system']as const){await page.emulateMedia({colorScheme:'dark'});await theme(page,scheme);await settle(page);
          for(const [badge,tone]of [['green','success'],['amber','warning'],['red','error'],['blue','info']]as const){
            const feedback=await page.locator('.feedback.feedback-tone-'+tone).evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
            const readPalette=()=>page.locator('.badge.'+badge).evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
            await browserExpect.poll(readPalette).toEqual(feedback);const palette=await readPalette();expect(contrast(palette.color,palette.background)).toBeGreaterThanOrEqual(4.5);
          }
          for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            const tabs=page.getByRole('navigation',{name:'考试模块'});expect(await tabs.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
            expect(await tabs.locator('.module-title').evaluateAll(labels=>labels.every(el=>{const range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect(),box=el.getBoundingClientRect();return text.width<=box.width+1&&text.height<=box.height+1;}))).toBe(true);
            await page.screenshot({path:join(screens,`components-${engine}-${width}-${scheme}.png`),fullPage:true,animations:'disabled'});
          }
        }
      }finally{await browser.close();}
    },30000);
    it(`keeps additional modules locally scrollable and keyboard reachable in ${engine}`,async()=>{
      const browser=await launch(),page=await browser.newPage({viewport:{width:320,height:700}});
      try{await prepare(page);await page.getByRole('button',{name:'切换更多模块',exact:true}).click();const nav=page.getByRole('navigation',{name:'考试模块',exact:true}),last=nav.getByRole('button',{name:'附加模块',exact:true});
        expect(await nav.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);await nav.getByRole('button').first().focus();
        for(let i=0;i<5;i++)await page.keyboard.press('Tab');await browserExpect(last).toBeFocused();
        expect(await last.evaluate(el=>{const box=el.getBoundingClientRect(),container=el.closest('nav')?.getBoundingClientRect();return !!container&&box.left>=container.left-1&&box.right<=container.right+1;})).toBe(true);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:join(screens,`modules-${engine}-320.png`),animations:'disabled'});
      }finally{await browser.close();}
    },20000);
    it(`animates dialogs once, retains focus and respects reduced motion in ${engine}`,async()=>{
      const browser=await launch(),page=await browser.newPage({viewport:{width:390,height:844}});
      try{await page.emulateMedia({reducedMotion:'no-preference'});await prepare(page);await browserExpect.poll(()=>page.evaluate(()=>Number(document.documentElement.dataset.answerStarts??0))).toBe(1);await page.getByRole('button',{name:'同步状态',exact:true}).click();await settle(page);expect(await page.evaluate(()=>Number(document.documentElement.dataset.answerStarts))).toBe(1);await page.getByRole('button',{name:'下一题',exact:true}).click();await browserExpect.poll(()=>page.evaluate(()=>Number(document.documentElement.dataset.answerStarts??0))).toBe(2);const open=page.getByRole('button',{name:'打开表单',exact:true});await open.click();const dialog=page.getByRole('dialog',{name:'编辑考试',exact:true});await dialog.waitFor();
        await browserExpect.poll(()=>page.evaluate(()=>Number(document.documentElement.dataset.overlayStarts??0))).toBe(1);
        await dialog.getByRole('button',{name:'更新弹窗状态',exact:true}).click();await browserExpect(dialog.getByLabel('弹窗同步次数')).toHaveText('2');await settle(page);expect(await page.evaluate(()=>Number(document.documentElement.dataset.overlayStarts))).toBe(1);
        await page.keyboard.press('Escape');await browserExpect(dialog).toHaveCount(0);await browserExpect(open).toBeFocused();
        await page.getByRole('button',{name:'账户菜单',exact:true}).click();const menu=page.getByRole('menu',{name:'账户',exact:true});await menu.waitFor();expect(await menu.evaluate(el=>getComputedStyle(el).animationName)).not.toBe('none');await page.keyboard.press('Escape');await browserExpect(page.getByRole('button',{name:'账户菜单',exact:true})).toBeFocused();
        await page.emulateMedia({reducedMotion:'reduce'});await open.click();await dialog.waitFor();expect(await dialog.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');expect(await page.locator('.current-answer').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');await page.keyboard.press('Escape');await browserExpect(open).toBeFocused();
      }finally{await browser.close();}
    },20000);
    it(`keeps long form actions visible without covering the focused field in ${engine}`,async()=>{
      const browser=await launch(),page=await browser.newPage({viewport:{width:320,height:640}});
      try{await prepare(page);await page.getByRole('button',{name:'打开表单',exact:true}).click();const dialog=page.getByRole('dialog',{name:'编辑考试',exact:true}),save=dialog.getByRole('button',{name:'保存',exact:true});
        const geometry=async()=>({body:await dialog.locator('.dialog-body').boundingBox(),save:await save.boundingBox()});const before=await geometry();expect(before.save&&before.body&&before.save.y>=before.body.y&&before.save.y+before.save.height<=before.body.y+before.body.height).toBe(true);
        await dialog.getByLabel('字段10',{exact:true}).focus();await settle(page);const field=await dialog.getByLabel('字段10',{exact:true}).boundingBox(),footer=await dialog.locator('.dialog-footer').boundingBox();expect(field&&footer&&field.y+field.height<=footer.y+1).toBe(true);
        await page.screenshot({path:join(screens,`form-${engine}-320.png`),fullPage:false,animations:'disabled'});expect(await save.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        await save.click();const alert=dialog.getByRole('alert');await alert.waitFor();const failure=await alert.boundingBox(),actions=await save.boundingBox(),box=await dialog.boundingBox();expect(failure&&actions&&box&&failure.y>=box.y&&failure.y+failure.height<=actions.y).toBe(true);
        await dialog.getByLabel('字段10',{exact:true}).focus();await settle(page);const focused=await dialog.getByLabel('字段10',{exact:true}).boundingBox(),area=await dialog.locator('.dialog-body').boundingBox(),footerTop=await dialog.locator('.dialog-footer').boundingBox();expect(focused&&area&&footerTop&&focused.y>=area.y&&focused.y+focused.height<=footerTop.y).toBe(true);
        await page.screenshot({path:join(screens,`form-error-${engine}-320.png`),animations:'disabled'});
      }finally{await browser.close();}
    },20000);
  }
});

function gate() {
  let release: () => void = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function syncHarness(contents: string) {
  const result = await build({stdin:{contents,resolveDir:join(process.cwd(),'apps/exam-web'),loader:'tsx'},outfile:'sync.js',write:false,bundle:true,jsx:'automatic',format:'esm',platform:'browser',alias:{katex:join(process.cwd(),'packages/web-ui/node_modules/katex')},loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
  const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text;
  if (!js) throw new Error('MISSING_SYNC_ASSET');
  return { js, html: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/sync.js"></script>' };
}
const fakeSocket = `window.WebSocket=class {
  static OPEN=1;readyState=0;
  change=e=>this.onmessage?.({data:JSON.stringify({type:'changed',attemptId:e.detail.id,lastSeq:e.detail.seq})});
  constructor(){window.addEventListener('sync-test-change',this.change);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
  send(raw){const message=JSON.parse(raw);if(message.type==='heartbeat'){document.documentElement.dataset.beats=String(Number(document.documentElement.dataset.beats??0)+1);this.onmessage?.({data:JSON.stringify({type:'heartbeat'})});}}
  close(){this.readyState=3;window.removeEventListener('sync-test-change',this.change);this.onclose?.();}
};`;
function syntheticAttempt() {
  const id = randomUUID(), moduleId = randomUUID();
  return ExamAttemptSchema.parse({id,assignmentId:randomUUID(),studentId:randomUUID(),studentName:'同步回归学生',title:'同步回归',exam:'sat',state:'in_progress',opensAt:new Date().toISOString(),closesAt:null,nextSlotId:null,lastSeq:1,simulation:false,
    modules:[{id:moduleId,code:'math',title:'数学',sectionCode:'math',questionCount:2,durationSeconds:null,position:1,state:'in_progress'}],
    slots:[1,2].map(position=>({id:randomUUID(),moduleId,position,ordinal:position,revision:1,status:'completed',completedOnce:true,runId:randomUUID(),errorCode:null,presentation:{answer:'原答案',selectedOptions:null,verified:true,simulated:false,humanConfirmed:false,notAppliedReason:null},images:[]}))});
}
async function visibility(page: Page, value: 'hidden'|'visible') {
  await page.evaluate(value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));},value);
}
async function changed(page: Page, id: string, seq: number) {
  await page.evaluate(detail=>window.dispatchEvent(new CustomEvent('sync-test-change',{detail})),{id,seq});
}
describe('browser synchronization and reading continuity',()=>{
  for (const engine of ['chrome','webkit'] as const) {
    const launch=()=>engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch();
    it(`pauses hidden list polling and coalesces foreground recovery without losing input in ${engine}`,async()=>{
      const bundle=await syncHarness(`import{useState}from'react';import{createRoot}from'react-dom/client';import{z}from'zod';import{usePageResource}from'./src/browser/paging.tsx';const schema=z.object({value:z.number()});function App(){const r=usePageResource(schema,'/list');const[draft,setDraft]=useState('');return <><input aria-label="草稿" value={draft} onChange={e=>setDraft(e.target.value)}/><output>{r.data?.value}</output><button onClick={()=>void r.refreshManually()}>刷新</button></>};createRoot(document.getElementById('root')).render(<App/>);`);
      const browser=await launch(),page=await browser.newPage();let reads=0,hold=false;const held=gate();
      try{await page.clock.install();await page.route('http://127.0.0.1:3199/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/v2/list'){const value=++reads;if(hold)await held.promise;return route.fulfill({json:{value}});}return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/html',body:path==='/sync.js'?bundle.js:bundle.html});});
        await page.goto('http://127.0.0.1:3199');await browserExpect(page.locator('output')).toHaveText('1');
        const input=page.getByLabel('草稿');await input.fill('保留阅读位置和未保存内容');const node=await input.elementHandle();
        await visibility(page,'hidden');await page.clock.runFor(20000);expect(reads).toBe(1);
        await page.getByRole('button',{name:'刷新',exact:true}).click();await browserExpect(page.locator('output')).toHaveText('2');
        hold=true;await visibility(page,'visible');await page.evaluate(()=>window.dispatchEvent(new Event('online')));await browserExpect.poll(()=>reads).toBe(3);held.release();await browserExpect(page.locator('output')).toHaveText('3');
        expect(reads).toBe(3);expect(await node?.evaluate(el=>el.isConnected)).toBe(true);await browserExpect(input).toHaveValue('保留阅读位置和未保存内容');
      }finally{held.release();await browser.close();}
    },20000);
    it(`joins initial socket and reads, then waits for a fresh snapshot after saving in ${engine}`,async()=>{
      const state=syntheticAttempt();
      const bundle=await syncHarness(`import{useState}from'react';import{createRoot}from'react-dom/client';import{z}from'zod';import{useAttempt}from'./src/browser/use-attempt.ts';import{api,post}from'./src/browser/api.ts';function App(){const r=useAttempt('${state.id}');const[saved,setSaved]=useState(''),[busy,setBusy]=useState(false);return <><output aria-label="序号">{r.attempt?.lastSeq}</output><button disabled={busy} onClick={async()=>{setBusy(true);await api('/write',z.object({ok:z.boolean()}),post({}));const next=await r.refresh();setSaved(String(next?.lastSeq));setBusy(false);}}>保存</button><output aria-label="保存结果">{saved}</output><span role="alert">{r.error}</span></>};createRoot(document.getElementById('root')).render(<App/>);`);
      const browser=await launch(),page=await browser.newPage();const first=gate(),background=gate(),fresh=gate(),later=gate();let reads=0,writes=0,inFlight=0,maxInFlight=0;
      try{await page.clock.install();await page.addInitScript(fakeSocket.replace('},0);','},1000);'));await page.route('http://127.0.0.1:3199/**',async route=>{const path=new URL(route.request().url()).pathname;
          if(path.endsWith('/snapshot')){const index=++reads,body=JSON.stringify(state);maxInFlight=Math.max(maxInFlight,++inFlight);if(index===1)await first.promise;if(index===2)await background.promise;if(index===3)await fresh.promise;if(index===4)await later.promise;inFlight--;return route.fulfill({json:JSON.parse(body)});}
          if(path==='/api/v2/write'){writes++;state.lastSeq=3;return route.fulfill({json:{ok:true}});}return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/html',body:path==='/sync.js'?bundle.js:bundle.html});});
        await page.goto('http://127.0.0.1:3199');await browserExpect.poll(()=>reads).toBe(1);await page.clock.runFor(1);await changed(page,state.id,1);first.release();await browserExpect(page.getByLabel('序号')).toHaveText('1');await page.clock.runFor(1000);await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>r())));expect(reads).toBe(1);
        await page.clock.runFor(20000);await browserExpect.poll(()=>reads).toBe(2);await page.getByRole('button',{name:'保存',exact:true}).click();await browserExpect.poll(()=>writes).toBe(1);await changed(page,state.id,2);await changed(page,state.id,3);expect(reads).toBe(2);background.release();await browserExpect.poll(()=>reads).toBe(3);expect(maxInFlight).toBe(1);expect(await page.getByRole('button',{name:'保存',exact:true}).isDisabled()).toBe(true);state.lastSeq=4;await changed(page,state.id,4);fresh.release();await browserExpect(page.getByLabel('保存结果')).toHaveText('3');await browserExpect.poll(()=>reads).toBe(4);expect(await page.getByRole('button',{name:'保存',exact:true}).isDisabled()).toBe(false);later.release();await browserExpect(page.getByLabel('序号')).toHaveText('4');expect(writes).toBe(1);
        await visibility(page,'hidden');state.lastSeq=8;for(let seq=5;seq<=8;seq++)await changed(page,state.id,seq);await page.clock.runFor(20000);expect(reads).toBe(4);expect(Number(await page.locator('html').getAttribute('data-beats'))).toBeGreaterThan(0);
        await visibility(page,'visible');await page.evaluate(()=>window.dispatchEvent(new Event('online')));await browserExpect(page.getByLabel('序号')).toHaveText('8');expect(reads).toBe(5);expect(maxInFlight).toBe(1);
      }finally{first.release();background.release();fresh.release();later.release();await browser.close();}
    },20000);
    it(`does not drop a socket change that arrives during the first snapshot in ${engine}`,async()=>{
      const state=syntheticAttempt(),held=gate();let reads=0;
      const bundle=await syncHarness(`import{createRoot}from'react-dom/client';import{useAttempt}from'./src/browser/use-attempt.ts';function App(){const r=useAttempt('${state.id}');return <output>{r.attempt?.lastSeq}</output>};createRoot(document.getElementById('root')).render(<App/>);`);
      const browser=await launch(),page=await browser.newPage();
      try{await page.addInitScript(fakeSocket);await page.route('http://127.0.0.1:3199/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/snapshot')){const body=JSON.stringify(state);if(++reads===1)await held.promise;return route.fulfill({json:JSON.parse(body)});}return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/html',body:path==='/sync.js'?bundle.js:bundle.html});});await page.goto('http://127.0.0.1:3199');await browserExpect.poll(()=>reads).toBe(1);state.lastSeq=2;await changed(page,state.id,2);held.release();await browserExpect(page.locator('output')).toHaveText('2');expect(reads).toBe(2);
      }finally{held.release();await browser.close();}
    },20000);
    it(`fences old attempts and recovers a failed snapshot through HTTP fallback in ${engine}`,async()=>{
      const old=syntheticAttempt(),next=syntheticAttempt(),held=gate();next.lastSeq=20;let oldReads=0,nextReads=0,fail=false;
      const bundle=await syncHarness(`import{useState}from'react';import{createRoot}from'react-dom/client';import{useAttempt}from'./src/browser/use-attempt.ts';function Reader({id}){const r=useAttempt(id);return <><output>{r.attempt?.id+':'+r.attempt?.lastSeq}</output><span role="alert">{r.error}</span></>};function App(){const[id,setId]=useState('${old.id}');return <><button onClick={()=>setId('${next.id}')}>切换考试</button><Reader id={id}/></>};createRoot(document.getElementById('root')).render(<App/>);`);
      const browser=await launch(),page=await browser.newPage();page.setDefaultTimeout(4000);
      try{await page.clock.install();await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=3;constructor(){setTimeout(()=>this.onclose?.(),0)}send(){}close(){}};`);await page.route('http://127.0.0.1:3199/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/v2/attempts/'+old.id+'/snapshot'){oldReads++;await held.promise;return route.fulfill({json:old});}if(path==='/api/v2/attempts/'+next.id+'/snapshot'){nextReads++;return route.fulfill(fail?{status:503,json:{message:'合成同步失败'}}:{json:next});}return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/html',body:path==='/sync.js'?bundle.js:bundle.html});});
        await page.goto('http://127.0.0.1:3199');await browserExpect.poll(()=>oldReads).toBe(1);await page.getByRole('button',{name:'切换考试',exact:true}).click();await browserExpect(page.locator('output')).toHaveText(next.id+':20');held.release();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>r())));await browserExpect(page.locator('output')).toHaveText(next.id+':20');
        fail=true;await page.clock.runFor(5000);await browserExpect(page.getByRole('alert')).toHaveText('合成同步失败');const failedReads=nextReads;await page.clock.runFor(1);expect(nextReads).toBe(failedReads);await browserExpect(page.locator('output')).toHaveText(next.id+':20');fail=false;next.lastSeq=21;await page.clock.runFor(5000);await browserExpect(page.locator('output')).toHaveText(next.id+':21');await browserExpect(page.getByRole('alert')).toBeEmpty();expect(oldReads).toBe(1);
      }finally{held.release();await browser.close();}
    },20000);
    it(`keeps the teacher question stable on unrelated updates and reloads changed material in ${engine}`,async()=>{
      const state=syntheticAttempt(),first=state.slots[0];if(!first)throw new Error('MISSING_SYNTHETIC_SLOT');let detailReads=0;
      const bundle=await syncHarness(`import{createRoot}from'react-dom/client';import{Monitor}from'./src/browser/monitor.tsx';createRoot(document.getElementById('root')).render(<Monitor id="${state.id}" initialSlotId="${first.id}" onClose={()=>{}}/>);`);
      const browser=await launch(),page=await browser.newPage();page.setDefaultTimeout(4000);
      try{await page.addInitScript(fakeSocket);await page.route('http://127.0.0.1:3199/**',route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/snapshot'))return route.fulfill({json:state});if(path==='/api/v2/slots/'+first.id){detailReads++;return route.fulfill({json:{slot:first,problem:{subject:'math',text:'STABLE QUESTION',uncertainties:[]},outcome:null,humanReviews:[],revisions:[]}});}return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/html',body:path==='/sync.js'?bundle.js:bundle.html});});
        await page.goto('http://127.0.0.1:3199');await page.getByText('STABLE QUESTION',{exact:true}).waitFor();expect(detailReads).toBe(1);
        await page.getByRole('tab',{name:'手动作答',exact:true}).click();const note=page.getByLabel('处理意见',{exact:true});await note.fill('保留教师草稿');const node=await note.elementHandle();
        const second=state.slots[1];if(!second)throw new Error('MISSING_SECOND_SLOT');second.status='verifying';state.lastSeq++;await changed(page,state.id,state.lastSeq);await browserExpect(page.getByRole('button',{name:'数学 · 第2题',exact:true})).toHaveText(/校验/);expect(detailReads).toBe(1);expect(await node?.evaluate(el=>el.isConnected)).toBe(true);await browserExpect(note).toHaveValue('保留教师草稿');
        first.presentation={answer:'NEW ANSWER',selectedOptions:null,verified:false,simulated:false,humanConfirmed:true,notAppliedReason:null};first.reviewId=randomUUID();state.lastSeq++;await changed(page,state.id,state.lastSeq);await page.getByText('NEW ANSWER',{exact:true}).waitFor();expect(detailReads).toBe(2);await browserExpect(note).toHaveValue('保留教师草稿');
      }finally{await browser.close();}
    },20000);
    it(`reuses unchanged math while showing the next answer immediately in ${engine}`,async()=>{
      const bundle=await syncHarness(`import{useState}from'react';import{createRoot}from'react-dom/client';import katex from'katex';import{RichText}from'./src/browser/rich-text.tsx';const render=katex.renderToString;katex.renderToString=(...args)=>{document.documentElement.dataset.mathRenders=String(Number(document.documentElement.dataset.mathRenders??0)+1);return render(...args);};function App(){const[n,setN]=useState(0),[text,setText]=useState('答案：$x=29$');return <><output>{n}</output><button onClick={()=>setN(v=>v+1)}>同步</button><button onClick={()=>setText('答案：$x=30$')}>更新答案</button><section aria-label="答案"><RichText text={text}/></section></>};createRoot(document.getElementById('root')).render(<App/>);`);
      const browser=await launch(),page=await browser.newPage();
      try{await page.route('http://127.0.0.1:3199/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/html',body:path==='/sync.js'?bundle.js:bundle.html});});await page.goto('http://127.0.0.1:3199');await page.locator('.katex').waitFor();const node=await page.locator('.katex').elementHandle();for(let i=0;i<8;i++)await page.getByRole('button',{name:'同步',exact:true}).click();await browserExpect(page.locator('output')).toHaveText('8');expect(await page.locator('html').getAttribute('data-math-renders')).toBe('1');expect(await node?.evaluate(el=>el.isConnected)).toBe(true);await page.getByRole('button',{name:'更新答案',exact:true}).click();await browserExpect(page.locator('annotation')).toHaveText('x=30');expect(await page.locator('html').getAttribute('data-math-renders')).toBe('2');
      }finally{await browser.close();}
    },20000);
  }
});
