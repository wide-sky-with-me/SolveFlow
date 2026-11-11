import { AppState } from 'react-native';
import { secondClock } from './second-clock';

export function displayClock(tick: () => void) {
  return secondClock(tick, {
    active: () => AppState.currentState === null || AppState.currentState === 'active',
    subscribe: changed => { const subscription = AppState.addEventListener('change', changed); return () => subscription.remove(); },
  });
}
