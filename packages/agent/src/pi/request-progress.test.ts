import { expect, it } from 'vitest';
import { requestProgress } from './request-progress.js';

function fixture() {
  let now=0;
  const tasks=new Set<{at:number;callback:()=>void}>(),reasons:string[]=[],callbacks:(()=>void)[]=[];
  const watch=requestProgress((callback,ms)=>{const task={at:now+ms,callback};tasks.add(task);callbacks.push(callback);return()=>{tasks.delete(task);};},reason=>reasons.push(reason));
  const advance=(ms:number)=>{now+=ms;for(const task of [...tasks])if(task.at<=now)task.callback();};
  return {watch,tasks,reasons,callbacks,advance};
}
it('does not time out before actual dispatch and bounds the first meaningful content',()=>{
  const f=fixture(),start=f.watch.prepare();f.advance(200_000);expect(f.reasons).toEqual([]);start();f.advance(89_999);expect(f.reasons).toEqual([]);f.advance(1);expect(f.reasons).toEqual(['first_content_timeout']);expect(f.tasks.size).toBe(0);
});
it('allows a stream longer than either watchdog while progress continues',()=>{
  const f=fixture();f.watch.prepare()();
  for(let i=0;i<8;i++){f.advance(30_000);f.watch.progress();}
  expect(f.reasons).toEqual([]);f.watch.stop();expect(f.tasks.size).toBe(0);
});
it('times out only after a continuous idle interval and fences a cancelled timer',()=>{
  const f=fixture();f.watch.prepare()();const first=f.callbacks[0];f.watch.progress();f.advance(40_000);const old=f.callbacks[1];f.watch.progress();first?.();old?.();expect(f.reasons).toEqual([]);f.advance(59_999);expect(f.reasons).toEqual([]);f.advance(1);expect(f.reasons).toEqual(['stream_idle']);
});
it('does not count tool work or an old deferred dispatch against the next request',()=>{
  const f=fixture(),old=f.watch.prepare();f.watch.stop();f.advance(120_000);const next=f.watch.prepare();old();expect(f.tasks.size).toBe(0);next();f.watch.progress();f.watch.stop();for(const stale of f.callbacks)stale();expect(f.reasons).toEqual([]);expect(f.tasks.size).toBe(0);
});
it('leaves thinking-only output to its existing phase thinking guard',()=>{
  const f=fixture();f.watch.prepare()();f.watch.progress(false);f.advance(100_000);expect(f.reasons).toEqual([]);expect(f.tasks.size).toBe(0);f.watch.progress();f.advance(60_000);expect(f.reasons).toEqual(['stream_idle']);
});
