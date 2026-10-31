import { expect, test, type Page } from '@playwright/test';
const first='synthetic-photo-first-key-only',second='synthetic-photo-second-key-only';
async function login(page:Page,key=first) { await page.getByLabel('访问密钥',{exact:true}).fill(key);await page.getByRole('button',{name:'进入',exact:true}).click();await expect(page.getByRole('button',{name:'拍摄题目',exact:true})).toBeEnabled(); }
async function photo(page:Page) {
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=300;const x=c.getContext('2d');if(!x)throw new Error('CANVAS');x.fillStyle='#fff';x.fillRect(0,0,600,300);x.fillStyle='#111';x.font='28px sans-serif';x.fillText('Synthetic: what is 2 + 2?',35,120);return c.toDataURL('image/jpeg').split(',')[1]!;});
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'从相册选择',exact:true}).click();await(await chooser).setFiles({name:'synthetic-question.jpg',mimeType:'image/jpeg',buffer:Buffer.from(image,'base64')});await expect(page.getByRole('img',{name:'待解答题图',exact:true})).toBeVisible();
}
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
  await page.reload();await expect(page.getByRole('button',{name:'拍摄题目',exact:true})).toBeEnabled();await page.waitForTimeout(1800);expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+1);
  await page.getByRole('tab',{name:/历史记录/}).click();await page.locator('.history-open').click();await expect(page.getByRole('button',{name:'重新尝试',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重新尝试',exact:true}).click();await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible();await page.getByRole('button',{name:'停止',exact:true}).click();await expect(page.getByText('本次解答已停止。',{exact:true})).toBeVisible();
});
test('compact controls stay inside 320px, landscape and dark screens',async({page},info)=>{
  await page.goto('/');await login(page);for(const size of [{width:320,height:568},{width:844,height:390}]){await page.setViewportSize(size);await page.emulateMedia({colorScheme:'dark'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'拍摄题目',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath(`photo-${size.width}-dark.png`)});await page.getByRole('button',{name:'考试类型',exact:true}).click();const bounds=await page.locator('.exam-popover').boundingBox();expect(bounds).not.toBeNull();if(bounds){expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(size.height);}await page.keyboard.press('End');await expect(page.getByRole('option',{name:'TARA',exact:true})).toBeFocused();await page.screenshot({path:info.outputPath(`photo-${size.width}-menu-dark.png`)});await page.keyboard.press('Escape');}
});
test('failed answer persistence keeps the answer visible and retries storage without another solve',async({page})=>{
  await page.addInitScript(()=>{let fail=true;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const value:unknown=args[0],key:unknown=args[1];if(fail&&typeof key==='string'&&key.startsWith('record.')&&typeof value==='string'){const row=JSON.parse(value);if(row.session?.runs?.at(-1)?.status==='completed')throw new DOMException('Synthetic quota failure','QuotaExceededError');}return Reflect.apply(put,this,args);};Reflect.set(window,'restorePhotoStorage',()=>{fail=false;});});
  await page.goto('/');await login(page);await photo(page);const before=await(await page.request.get('/__test-state')).json();await page.getByRole('button',{name:'开始解题',exact:true}).click();await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toContainText('答案尚未保存');await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'退出登录',exact:true})).toBeDisabled();
  await page.evaluate(()=>Reflect.get(window,'restorePhotoStorage')());await page.getByRole('button',{name:'重试保存',exact:true}).click();await expect(page.getByRole('button',{name:'拍下一题',exact:true})).toBeEnabled();expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls+1);
  await page.reload();await page.getByRole('tab',{name:/历史记录/}).click();await page.locator('.history-open').click();await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();
});
test('exam menu supports keyboard, outside dismissal and the saved question exam snapshot',async({page},info)=>{
  await page.goto('/');await login(page);
  const trigger=page.getByRole('button',{name:'考试类型',exact:true});
  await trigger.click();await expect(page.getByRole('listbox',{name:'考试类型',exact:true})).toBeVisible();
  await expect(page.getByRole('option',{name:'ACT',exact:true})).toHaveAttribute('aria-selected','true');
  await page.screenshot({path:info.outputPath('photo-exam-menu.png')});
  await page.keyboard.press('Home');await expect(page.getByRole('option',{name:'未指定',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(trigger).toContainText('SAT');await expect(trigger).toBeFocused();await expect(page.getByRole('listbox')).toHaveCount(0);
  await trigger.press('ArrowDown');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(page.getByRole('listbox')).toHaveCount(0);
  await trigger.click();await page.getByRole('link',{name:'SolveFlow',exact:true}).click();await expect(page.getByRole('listbox')).toHaveCount(0);
  const before=await(await page.request.get('/__test-state')).json();
  await photo(page);expect((await(await page.request.get('/__test-state')).json()).calls).toBe(before.calls);
  const submitted=page.waitForRequest(r=>r.url().endsWith('/api/solve')&&r.method()==='POST');
  await page.getByRole('button',{name:'开始解题',exact:true}).click();
  const body:unknown=(await submitted).postDataJSON();expect(body).toMatchObject({exam:'sat'});
  await expect(trigger).toBeDisabled();await expect(page.getByRole('heading',{name:'答案 B',exact:true})).toBeVisible();await expect(trigger).toBeEnabled();
  await trigger.click();await page.getByRole('option',{name:'ACT',exact:true}).click();
  await page.getByRole('tab',{name:/历史记录/}).click();await page.locator('.history-open').click();await expect(trigger).toContainText('SAT');
});
