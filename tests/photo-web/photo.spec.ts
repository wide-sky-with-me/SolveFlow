import { expect, test, type Page } from '@playwright/test';
import { delayRetryPhotoRead, installTimingProbe } from './timing.js';
const first='synthetic-photo-first-key-only',second='synthetic-photo-second-key-only';
async function login(page:Page,key=first) { await page.getByLabel('访问密钥',{exact:true}).fill(key);await page.getByRole('button',{name:'进入',exact:true}).click();await expect(page.getByRole('button',{name:'拍摄题目',exact:true})).toBeEnabled(); }
async function photo(page:Page) {
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=300;const x=c.getContext('2d');if(!x)throw new Error('CANVAS');x.fillStyle='#fff';x.fillRect(0,0,600,300);x.fillStyle='#111';x.font='28px sans-serif';x.fillText('Synthetic: what is 2 + 2?',35,120);return c.toDataURL('image/jpeg').split(',')[1]!;});
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'从相册选择',exact:true}).click();await(await chooser).setFiles({name:'synthetic-question.jpg',mimeType:'image/jpeg',buffer:Buffer.from(image,'base64')});await expect(page.getByRole('img',{name:'待解答题图',exact:true})).toBeVisible();
}
test('delete confirmation contains keyboard focus, respects Escape and restores the trigger',async({page},info)=>{
  await page.goto('/');await login(page);await photo(page);await page.getByRole('button',{name:'开始解题',exact:true}).click();
  await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();await page.getByRole('tab',{name:/历史记录/}).click();
  const trigger=page.getByRole('button',{name:'删除历史记录',exact:true});await trigger.focus();await trigger.click();
  const dialog=page.getByRole('dialog',{name:'删除这条记录？',exact:true});await expect(dialog).toBeVisible();
  await page.screenshot({path:info.outputPath('delete-dialog-before-keyboard.png')});
  await expect(dialog.getByRole('button',{name:'保留',exact:true})).toBeFocused();
  for(let n=0;n<8;n++){await page.keyboard.press(n%2?'Shift+Tab':'Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"],dialog'))).toBe(true);}
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await page.setViewportSize({width:320,height:320});await trigger.click();
  const bounds=await dialog.boundingBox();expect(bounds).not.toBeNull();if(bounds){expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(320);}
  await expect(dialog.getByRole('button',{name:'删除记录',exact:true})).toBeInViewport();await page.screenshot({path:info.outputPath('delete-dialog-compact.png')});
  await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:info.outputPath('delete-dialog-compact-dark.png')});
  for(const button of await dialog.getByRole('button').all()){const box=await button.boundingBox();expect(box?.width).toBeGreaterThanOrEqual(44);expect(box?.height).toBeGreaterThanOrEqual(44);}
  await dialog.getByRole('button',{name:'保留',exact:true}).click();await expect(trigger).toBeFocused();
  await trigger.click();await dialog.getByRole('button',{name:'删除记录',exact:true}).evaluate(button=>{if(!(button instanceof HTMLButtonElement))throw new Error('EXPECTED_BUTTON');button.click();button.click();});
  await expect(page.getByRole('heading',{name:'还没有答题记录',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:/历史记录/})).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('a failed retry preserves the last answer with its own label and source photo',async({page},info)=>{
  await installTimingProbe(page);
  const start=Date.now(),traffic:{kind:string;ms:number;path:string;status?:number}[]=[];
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/jobs'))traffic.push({kind:request.method(),ms:Date.now()-start,path});});
  page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/api/jobs'))traffic.push({kind:'response',ms:Date.now()-start,path,status:response.status()});});
  page.on('requestfailed',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/jobs'))traffic.push({kind:'request-failed',ms:Date.now()-start,path});});
  await page.goto('/');await login(page);await page.request.post('/__test-outcome?mode=answer');await photo(page);await page.getByRole('button',{name:'开始解题',exact:true}).click();
  await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();
  const before=await(await page.request.get('/__test-state')).json();await page.request.post('/__test-outcome?mode=failed');
  await page.getByRole('button',{name:'重新解答',exact:true}).click();
  const clicked=Date.now();
  try{await expect(page.getByRole('alert')).toBeVisible();}finally{await info.attach('retry-request-timeline',{body:JSON.stringify({start,clicked,observed:Date.now(),traffic,browser:await page.evaluate(()=>Reflect.get(window,'photoTiming')),state:await(await page.request.get('/__test-state')).json()}),contentType:'application/json'});}
  await expect(page.getByRole('alert')).toHaveText('暂时无法完成解答，请稍后重试。');
  await page.screenshot({path:info.outputPath('failed-retry.png')});
  await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();await expect(page.getByText('上次答案',{exact:true})).toBeVisible();
  await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:info.outputPath('failed-retry-dark.png')});
  await page.getByText('查看题目',{exact:true}).click();await expect(page.getByRole('img',{name:'题目原图',exact:true})).toBeVisible();
  await page.reload();await page.getByRole('tab',{name:/历史记录/}).click();await page.locator('.history-open').click();
  await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+1);
});
test('a late photo read cannot turn a finished retry back into a waiting screen',async({page},info)=>{
  await installTimingProbe(page);await delayRetryPhotoRead(page);
  await page.goto('/');await login(page);await page.request.post('/__test-outcome?mode=answer');await photo(page);
  const before=await(await page.request.get('/__test-state')).json();
  await page.getByRole('button',{name:'开始解题',exact:true}).click();await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();
  await page.request.post('/__test-outcome?mode=failed');await page.getByRole('button',{name:'重新解答',exact:true}).click();
  try{
    await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'hasHeldPhotoRead'))).toBe(true);
    await expect(page.locator('.progress')).toContainText('正在解答');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.evaluate(()=>Reflect.get(window,'releaseHeldPhotoRead')());await page.waitForTimeout(150);
    await page.screenshot({path:info.outputPath('late-photo-read.png')});
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.progress')).toHaveCount(0);
    expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+2);
  }finally{
    await page.evaluate(()=>Reflect.get(window,'releaseHeldPhotoRead')());
    await info.attach('controlled-read-timeline',{body:JSON.stringify({browser:await page.evaluate(()=>Reflect.get(window,'photoTiming')),state:await(await page.request.get('/__test-state')).json()}),contentType:'application/json'});
  }
});
test('a first failed attempt keeps its source photo available after reload',async({page},info)=>{
  await page.goto('/');await login(page);await page.request.post('/__test-outcome?mode=failed');await photo(page);
  await page.getByRole('button',{name:'开始解题',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('暂时无法完成解答，请稍后重试。');
  await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toHaveCount(0);
  await page.getByText('查看题目',{exact:true}).click();await expect(page.getByRole('img',{name:'题目原图',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('initial-failure.png')});
  await page.reload();await page.getByRole('tab',{name:/历史记录/}).click();await page.locator('.history-open').click();
  await page.getByText('查看题目',{exact:true}).click();await expect(page.getByRole('img',{name:'题目原图',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重新尝试',exact:true}).click();await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:/历史记录/}).click();await expect(page.locator('.history-row')).toHaveCount(1);
});
test('incomplete photos retain a source preview and can be retried without creating another history row',async({page},info)=>{
  await page.goto('/');await login(page);await page.request.post('/__test-outcome?mode=clarification');await photo(page);await page.getByRole('button',{name:'开始解题',exact:true}).click();
  await expect(page.getByRole('heading',{name:'还需要补充信息',exact:true})).toBeVisible();
  await page.getByText('查看题目',{exact:true}).click();await expect(page.getByRole('img',{name:'题目原图',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('incomplete-photo.png')});await page.getByRole('button',{name:'重新解答',exact:true}).click();
  await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();await page.getByRole('tab',{name:/历史记录/}).click();await expect(page.locator('.history-row')).toHaveCount(1);
});
test('key login, phone photo answer and history survive reload; other key has separate history',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await expect(page.getByRole('heading',{name:'拍照解题',exact:true})).toBeVisible();
  await page.getByLabel('访问密钥',{exact:true}).fill('wrong-key');await page.getByRole('button',{name:'进入',exact:true}).click();await expect(page.getByRole('alert')).toContainText('不正确');
  await login(page);await expect(page.getByRole('button',{name:/设置|导出|批量/})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('photo-home.png')});await page.getByRole('button',{name:'考试类型',exact:true}).click();await page.getByRole('option',{name:'ACT',exact:true}).click();await photo(page);await page.getByRole('button',{name:'开始解题',exact:true}).click();
  await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();await expect(page.locator('.katex')).not.toHaveCount(0);for(const formula of await page.locator('.math.inline').all())await expect(formula).toHaveCSS('display','inline');await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'重新解答',exact:true})).toBeEnabled();
  await page.screenshot({path:info.outputPath('photo-answer.png')});await page.getByRole('tab',{name:/历史记录/}).click();await expect(page.locator('.history .history-row')).toHaveCount(1);await page.reload();await page.getByRole('tab',{name:/历史记录/}).click();await expect(page.locator('.history .history-row')).toHaveCount(1);
  await page.getByRole('button',{name:'退出登录',exact:true}).click();await login(page,second);await page.getByRole('tab',{name:/历史记录/}).click();await expect(page.getByText('还没有答题记录',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();await login(page);await page.getByRole('tab',{name:/历史记录/}).click();await expect(page.locator('.history .history-row')).toHaveCount(1);
  await page.getByRole('button',{name:'删除历史记录',exact:true}).click();await page.getByRole('button',{name:'保留',exact:true}).click();await expect(page.locator('.history .history-row')).toHaveCount(1);
  await page.getByRole('button',{name:'删除历史记录',exact:true}).click();await page.getByRole('button',{name:'删除记录',exact:true}).click();await expect(page.getByText('还没有答题记录',{exact:true})).toBeVisible();expect(errors).toEqual([]);
});
test('stopping and refresh do not restart paid work and the same browser cannot open a second active editor',async({page,context})=>{
  await page.goto('/');await login(page);const other=await context.newPage();await other.goto('/');await expect(other.getByRole('alert')).toContainText('已有拍题页面');await other.close();
  await photo(page);const before=await(await page.request.get('/__test-state')).json();await page.getByRole('button',{name:'开始解题',exact:true}).click();await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible();await expect.poll(async()=> (await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+1);
  await page.reload();await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();await page.waitForTimeout(1800);expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+1);
  await page.getByRole('tab',{name:/历史记录/}).click();await page.locator('.history-open').click();await expect(page.getByRole('button',{name:'重新解答',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重新解答',exact:true}).click();await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible();await page.getByRole('button',{name:'停止',exact:true}).click();await expect(page.getByText('本次解答已停止。',{exact:true})).toBeVisible();
});
test('compact controls stay inside 320px, landscape and dark screens',async({page},info)=>{
  await page.goto('/');await login(page);for(const size of [{width:320,height:568},{width:844,height:390}]){await page.setViewportSize(size);await page.emulateMedia({colorScheme:'dark'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'拍摄题目',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath(`photo-${size.width}-dark.png`)});await page.getByRole('button',{name:'考试类型',exact:true}).click();const bounds=await page.locator('.exam-popover').boundingBox();expect(bounds).not.toBeNull();if(bounds){expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(size.height);}await page.keyboard.press('End');await expect(page.getByRole('option',{name:'TARA',exact:true})).toBeFocused();await page.screenshot({path:info.outputPath(`photo-${size.width}-menu-dark.png`)});await page.keyboard.press('Escape');}
});
test('failed answer persistence keeps the answer visible and retries storage without another solve',async({page})=>{
  await page.addInitScript(()=>{let fail=true;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const value:unknown=args[0],key:unknown=args[1];if(fail&&typeof key==='string'&&key.startsWith('record.')&&typeof value==='string'){const row=JSON.parse(value);if(row.session?.runs?.at(-1)?.status==='completed')throw new DOMException('Synthetic quota failure','QuotaExceededError');}return Reflect.apply(put,this,args);};Reflect.set(window,'restorePhotoStorage',()=>{fail=false;});});
  await page.goto('/');await login(page);await photo(page);const before=await(await page.request.get('/__test-state')).json();const submitted=page.waitForRequest(r=>r.url().endsWith('/api/jobs')&&r.method()==='POST');await page.getByRole('button',{name:'开始解题',exact:true}).click();const body:unknown=(await submitted).postDataJSON();expect(body).toMatchObject({exam:'general'});await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toContainText('答案尚未保存');await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'退出登录',exact:true})).toBeDisabled();
  await page.evaluate(()=>Reflect.get(window,'restorePhotoStorage')());await page.getByRole('button',{name:'重试保存',exact:true}).click();await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeEnabled();expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+1);
  await page.reload();await page.getByRole('tab',{name:/历史记录/}).click();await page.locator('.history-open').click();await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();
});
test('exam menu supports keyboard, outside dismissal and the saved question exam snapshot',async({page},info)=>{
  await page.goto('/');await login(page);
  const trigger=page.getByRole('button',{name:'考试类型',exact:true});
  await expect(trigger).toContainText('未指定');await trigger.click();await expect(page.getByRole('listbox',{name:'考试类型',exact:true})).toBeVisible();
  await expect(page.getByRole('option',{name:'未指定',exact:true})).toHaveAttribute('aria-selected','true');
  await page.screenshot({path:info.outputPath('photo-exam-menu.png')});
  await page.keyboard.press('Home');await expect(page.getByRole('option',{name:'未指定',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(trigger).toContainText('SAT');await expect(trigger).toBeFocused();await expect(page.getByRole('listbox')).toHaveCount(0);
  await trigger.press('ArrowDown');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(page.getByRole('listbox')).toHaveCount(0);
  await trigger.click();await page.getByRole('link',{name:'SolveFlow',exact:true}).click();await expect(page.getByRole('listbox')).toHaveCount(0);
  const before=await(await page.request.get('/__test-state')).json();
  await photo(page);expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls);
  const submitted=page.waitForRequest(r=>r.url().endsWith('/api/jobs')&&r.method()==='POST');
  await page.getByRole('button',{name:'开始解题',exact:true}).click();
  const body:unknown=(await submitted).postDataJSON();expect(body).toMatchObject({exam:'sat'});
  await expect(trigger).toBeDisabled();await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();await expect(trigger).toBeEnabled();
  await trigger.click();await page.getByRole('option',{name:'ACT',exact:true}).click();
  await page.getByRole('tab',{name:/历史记录/}).click();await page.locator('.history-open').click();await expect(trigger).toContainText('SAT');
});
test('server keeps an accepted answer through a page reload and recovers it without another paid dispatch', async ({page}) => {
  await page.goto('/'); await login(page); await photo(page);
  const before = await (await page.request.get('/__test-state')).json();
  const accepted = page.waitForResponse(r => r.url().endsWith('/api/jobs') && r.request().method() === 'POST');
  await page.getByRole('button', {name:'开始解题',exact:true}).click(); expect((await accepted).status()).toBe(202);
  await page.reload();
  await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();
  const after = await (await page.request.get('/__test-state')).json(); expect(after.calls).toBe(before.calls+1); expect(after.cancellations).toBe(before.cancellations);
});
test('recovers an accepted answer after network loss without uploading or solving again', async ({page,context},info) => {
  await installTimingProbe(page);
  await page.goto('/'); await login(page); await photo(page);
  const before = await (await page.request.get('/__test-state')).json();
  let submissions = 0; page.on('request', request => { if (request.url().endsWith('/api/jobs') && request.method() === 'POST') submissions++; });
  const accepted = page.waitForResponse(r => r.url().endsWith('/api/jobs') && r.request().method() === 'POST');
  await page.getByRole('button',{name:'开始解题',exact:true}).click(); expect((await accepted).status()).toBe(202);
  try {
    await context.setOffline(true); await page.waitForTimeout(2200);
    await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toHaveCount(0);
  } finally { await context.setOffline(false); }
  try{await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();}
  finally{await info.attach('network-recovery-timeline',{body:JSON.stringify({browser:await page.evaluate(()=>Reflect.get(window,'photoTiming')),state:await(await page.request.get('/__test-state')).json()}),contentType:'application/json'});}
  const after = await (await page.request.get('/__test-state')).json();
  expect(after.calls).toBe(before.calls+1); expect(after.cancellations).toBe(before.cancellations); expect(submissions).toBe(1);
});
test('a stalled status read is replaced after reconnection without submitting the photo again',async({page,context},info)=>{
  await installTimingProbe(page);
  await page.addInitScript(()=>{
    const fetch=window.fetch;let used=false;
    const log=(kind:string)=>{const events:unknown=Reflect.get(window,'photoTiming');if(Array.isArray(events))events.push({at:Date.now(),kind});};
    Reflect.set(window,'stalledStatusRead',false);
    window.fetch=function(input:RequestInfo|URL,init?:RequestInit):Promise<Response>{
      const path=typeof input==='string'?input:input instanceof URL?input.href:input.url;
      if(!used&&!navigator.onLine&&/\/api\/jobs\/[a-f0-9-]{36}$/.test(path)&&(!init?.method||init.method==='GET')){
        used=true;Reflect.set(window,'stalledStatusRead',true);
        log('status-read-stalled');
        return new Promise((_resolve,reject)=>{const signal=init?.signal;if(!signal){reject(new Error('EXPECTED_STATUS_READ_SIGNAL'));return;}const stop=()=>{log('status-read-aborted');reject(signal.reason);};if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});});
      }
      return Reflect.apply(fetch,window,[input,init]);
    };
  });
  await page.goto('/');await login(page);await photo(page);
  const before=await(await page.request.get('/__test-state')).json();
  const accepted=page.waitForResponse(response=>response.url().endsWith('/api/jobs')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'开始解题',exact:true}).click();await accepted;
  try{
    await context.setOffline(true);
    await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'stalledStatusRead'))).toBe(true);
    await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();
    expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+1);
  }finally{
    await context.setOffline(false);
    await info.attach('stalled-read-timeline',{body:JSON.stringify({browser:await page.evaluate(()=>Reflect.get(window,'photoTiming')),state:await(await page.request.get('/__test-state')).json()}),contentType:'application/json'});
  }
});
for (const reloadBeforeStop of [false, true]) test(`stopping an unaccepted upload clears pending controls; reload before stop=${reloadBeforeStop}`, async ({page}, info) => {
  await page.goto('/'); await login(page); await photo(page);
  const before = await (await page.request.get('/__test-state')).json();
  await page.route('**/api/jobs', route => route.abort('failed'));
  await page.getByRole('button',{name:'开始解题',exact:true}).click();
  await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible();
  if (reloadBeforeStop) { await page.reload(); await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible(); }
  await page.getByRole('button',{name:'停止',exact:true}).click();
  await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'停止',exact:true})).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('stopped-before-upload.png')});
  await page.reload(); await page.getByRole('tab',{name:/历史记录/}).click(); await page.locator('.history-open').click();
  await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await (await page.request.get('/__test-state')).json()).calls).toBe(before.calls);
});
for (const reloadPendingCancel of [false, true]) test(`offline cancellation releases the page and survives reload=${reloadPendingCancel}`, async ({page,context},info) => {
  await page.goto('/');await login(page);await photo(page);
  const before=await(await page.request.get('/__test-state')).json();
  const accepted=page.waitForResponse(response=>response.url().endsWith('/api/jobs')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'开始解题',exact:true}).click();expect((await accepted).status()).toBe(202);
  try {
    await context.setOffline(true);await page.getByRole('button',{name:'停止',exact:true}).click();
    await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeEnabled();
    await expect(page.getByText('本次解答已停止。',{exact:true})).toBeVisible();
    await expect(page.getByText('停止请求待联网同步。',{exact:true})).toBeVisible();
    if(reloadPendingCancel){
      await page.route('**/api/jobs/*/cancel',route=>route.abort());await context.setOffline(false);await page.reload();
      await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeEnabled();
      await expect(page.getByText('停止请求待联网同步。',{exact:true})).toBeVisible();
    }
    await page.screenshot({path:info.outputPath('offline-cancel.png')});
    await page.unroute('**/api/jobs/*/cancel');await context.setOffline(false);
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await expect(page.getByText('停止请求待联网同步。',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeEnabled();
    await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toHaveCount(0);
    await page.reload();await page.getByRole('tab',{name:/历史记录/}).click();await page.locator('.history-open').click();
    await expect(page.getByText('本次解答已停止。',{exact:true})).toBeVisible();
    expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+1);
  } finally {await context.setOffline(false);}
});
test('a late failed stop request cannot restore a cancellation already acknowledged by the server',async({page})=>{
  await page.goto('/');await login(page);await photo(page);
  const before=await(await page.request.get('/__test-state')).json();
  const accepted=page.waitForResponse(response=>response.url().endsWith('/api/jobs')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'开始解题',exact:true}).click();await accepted;
  let cancellations=0;
  await page.route('**/api/jobs/*/cancel',async route=>{
    cancellations++;
    if(cancellations===2){await route.fulfill({response:await route.fetch()});return;}
    await new Promise(resolve=>setTimeout(resolve,200));await route.abort();
  });
  await page.getByRole('button',{name:'停止',exact:true}).evaluate(button=>{if(!(button instanceof HTMLButtonElement))throw new Error('EXPECTED_BUTTON');button.click();button.click();});
  await expect(page.getByText('本次解答已停止。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeEnabled();
  await page.waitForTimeout(350);
  await expect(page.getByText('停止请求待联网同步。',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toHaveCount(0);
  expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+1);
});
