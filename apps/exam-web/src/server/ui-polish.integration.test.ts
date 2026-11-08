import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit, expect as browserExpect, type Page } from '@playwright/test';

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
