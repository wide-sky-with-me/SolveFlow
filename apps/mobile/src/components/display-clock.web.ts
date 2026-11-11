import { secondClock } from './second-clock';

export function displayClock(tick: () => void) {
  return secondClock(tick, {
    active: () => document.visibilityState === 'visible',
    subscribe: changed => { document.addEventListener('visibilitychange', changed); return () => document.removeEventListener('visibilitychange', changed); },
  });
}
