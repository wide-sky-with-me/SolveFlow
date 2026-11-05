import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IMAGE_CACHE_BYTES, SessionImageCache, imagePaths } from './image-cache.js';

const path=(number=1,view='source')=>`/api/v2/media/00000000-0000-4000-8000-${String(number).padStart(12,'0')}?view=${view}`;
const picture=(bytes=64)=>new Response(new Uint8Array(bytes),{headers:{'content-type':'image/jpeg'}});
const fetcher=vi.fn<typeof fetch>();
let cache:SessionImageCache;
beforeEach(()=>{
    cache=new SessionImageCache();vi.stubGlobal('fetch',fetcher);vi.stubGlobal('window',new EventTarget());
    let number=0;vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:synthetic-${++number}`);vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    fetcher.mockReset().mockImplementation(async()=>picture());
});
afterEach(()=>{cache.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

it('derives the clear preview only from an internal source URL',()=>{
    expect(imagePaths(path()).preview).toBe(path(1,'model'));
    for(const invalid of ['https://example.com/a.jpg','/api/v2/media/not-a-uuid?view=source',path()+'&token=private'])expect(()=>imagePaths(invalid)).toThrow();
});
it('deduplicates downloads, retains completed blobs, and revalidates every reuse',async()=>{
    const a=cache.acquire(path()),b=cache.acquire(path());expect(await a.promise).toEqual(await b.promise);expect(fetcher).toHaveBeenCalledTimes(1);a.release();b.release();
    const reused=cache.acquire(path());expect(await reused.promise).toEqual(await a.promise);expect(fetcher.mock.calls[1]?.[1]?.method).toBe('HEAD');reused.release();
    cache.dispose();expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);expect(()=>cache.acquire(path())).toThrow();
});
it('aborts only after the final viewer releases an unfinished request',async()=>{
    let finish:(response:Response)=>void=()=>{};fetcher.mockImplementation(()=>new Promise(resolve=>finish=resolve));
    const a=cache.acquire(path()),b=cache.acquire(path()),settled=Promise.allSettled([a.promise,b.promise]);
    const signal=fetcher.mock.calls[0]?.[1]?.signal;a.release();expect(signal?.aborted).toBe(false);b.release();expect(signal?.aborted).toBe(true);
    finish(picture());expect((await settled).every(result=>result.status==='rejected')).toBe(true);expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('bounds pending downloads and rejects oversized or unsupported image content',async()=>{
    const completions:Array<(response:Response)=>void>=[];fetcher.mockImplementation(()=>new Promise(resolve=>completions.push(resolve)));
    const pending=Array.from({length:4},(_,i)=>cache.acquire(path(i+1))),settled=Promise.allSettled(pending.map(value=>value.promise));
    expect(()=>cache.acquire(path(5))).toThrow('正在加载');cache.dispose();for(const finish of completions)finish(picture());
    expect((await settled).every(result=>result.status==='rejected')).toBe(true);
    // Use a separate cache for the completed response constraints.
    const limited=new SessionImageCache();
    try{
        fetcher.mockResolvedValue(new Response('bad',{headers:{'content-type':'text/html'}}));await expect(limited.acquire(path(9)).promise).rejects.toThrow('格式');
        fetcher.mockResolvedValue(picture(10*1024*1024+1));await expect(limited.acquire(path(10)).promise).rejects.toThrow('大小');
        fetcher.mockResolvedValue(new Response('x',{headers:{'content-type':'image/jpeg','content-length':String(11*1024*1024)}}));await expect(limited.acquire(path(11)).promise).rejects.toThrow('大小');
    }finally{limited.dispose();}
});
it('evicts unpinned originals and never discards images held by an open viewer',async()=>{
    const held=cache.acquire(path());await held.promise;
    const second=cache.acquire(path(2));await second.promise;second.release();
    const third=cache.acquire(path(3));await third.promise;expect(cache.has(path())).toBe(true);expect(cache.has(path(2))).toBe(false);third.release();
    const pinned=cache.acquire(path(4));await pinned.promise;
    await expect(cache.acquire(path(5)).promise).rejects.toThrow('关闭其他图片');expect(cache.has(path())).toBe(true);held.release();pinned.release();
});
it('keeps encoded cached data within its byte budget and entry count',async()=>{
    fetcher.mockImplementation(async()=>picture(4*1024*1024));
    for(let index=1;index<=6;index++){const lease=cache.acquire(path(index,'model'));await lease.promise;lease.release();}
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBe(2);expect(IMAGE_CACHE_BYTES).toBe(16*1024*1024);
    cache.dispose();cache=new SessionImageCache();fetcher.mockImplementation(async()=>picture());
    for(let index=1;index<=10;index++){const lease=cache.acquire(path(index,'model'));await lease.promise;lease.release();}
    expect(cache.has(path(1,'model'))).toBe(false);expect(cache.has(path(3,'model'))).toBe(true);
});
it('denies cached content after permissions are revoked and notifies on expired login',async()=>{
    const initial=cache.acquire(path());await initial.promise;initial.release();
    fetcher.mockResolvedValue(new Response(null,{status:404}));await expect(cache.acquire(path()).promise).rejects.toThrow('权限');expect(cache.has(path())).toBe(false);
    const expired=vi.fn();window.addEventListener('exam-auth-expired',expired);fetcher.mockResolvedValue(new Response(null,{status:401}));
    await expect(cache.acquire(path(2)).promise).rejects.toThrow('登录');expect(expired).toHaveBeenCalledTimes(1);
});
it('fences late session responses and an older failed validation of the same URL',async()=>{
    const initial=cache.acquire(path());await initial.promise;initial.release();
    let finish:(response:Response)=>void=()=>{};fetcher.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
    const old=cache.acquire(path()),failed=old.promise.catch(error=>error);cache.forget(path());
    const fresh=cache.acquire(path());await fresh.promise;finish(new Response(null,{status:404}));await failed;expect(cache.has(path())).toBe(true);fresh.release();old.release();
    const expired=vi.fn();window.addEventListener('exam-auth-expired',expired);fetcher.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
    const late=cache.acquire(path(2)),cancelled=late.promise.catch(error=>error);cache.dispose();finish(new Response(null,{status:401}));await cancelled;expect(expired).not.toHaveBeenCalled();
});
it('cancels an image download at its deadline without storing its late result',async()=>{
    vi.useFakeTimers();let finish:(response:Response)=>void=()=>{};fetcher.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
    const pending=cache.acquire(path()),rejected=pending.promise.catch(error=>error);await vi.advanceTimersByTimeAsync(50000);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);finish(picture());expect(await rejected).toBeInstanceOf(DOMException);expect(cache.has(path())).toBe(false);
});
