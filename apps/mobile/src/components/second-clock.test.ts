import { afterEach, expect, it, vi } from 'vitest';
import { secondClock } from './second-clock';
afterEach(()=>vi.useRealTimers());

it('updates once per second, pauses in the background and catches up on return',()=>{
  vi.useFakeTimers();vi.setSystemTime(0);let active=true,change=()=>{},unsubscribed=false;const times:number[]=[];
  const stop=secondClock(()=>times.push(Date.now()),{active:()=>active,subscribe:callback=>{change=callback;return()=>{unsubscribed=true;};}});
  vi.advanceTimersByTime(3000);expect(times).toEqual([0,1000,2000,3000]);active=false;change();vi.advanceTimersByTime(120_000);expect(times).toHaveLength(4);
  active=true;change();expect(times.at(-1)).toBe(123_000);vi.advanceTimersByTime(1000);expect(times.at(-1)).toBe(124_000);stop();vi.advanceTimersByTime(10_000);expect(times).toHaveLength(6);expect(unsubscribed).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('does not allocate a background timer and cannot restart after disposal',()=>{
  vi.useFakeTimers();let active=false,change=()=>{};const tick=vi.fn();const stop=secondClock(tick,{active:()=>active,subscribe:callback=>{change=callback;return()=>{};}});
  expect(vi.getTimerCount()).toBe(0);expect(tick).not.toHaveBeenCalled();stop();active=true;change();expect(tick).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
