import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, ToastAndroid } from 'react-native';
import { forgetCurrentRecords, NavigationState, type CurrentPage, type WorkspacePage } from './navigation-state';
export function useWorkspaceNavigation() {
  const state = useRef(new NavigationState()).current;
  const [route, setRoute] = useState(state.route); const current = useRef<CurrentPage>({ page: 'current' });
  if (route.page === 'current') current.current = route;
  const navigate = useCallback((next: WorkspacePage, replace = false) => {
    if (!state.navigate(next, replace)) return;
    if (Platform.OS === 'web') window.history[replace ? 'replaceState' : 'pushState']({ solveflowNavigation: state.key }, '', window.location.href);
    setRoute(state.route);
  }, [state]);
  const forgetRecords = useCallback((records: ReadonlySet<string>, batches: ReadonlySet<string>) => {
    state.forgetRecords(records, batches);
    current.current = forgetCurrentRecords(current.current, records, batches);
    setRoute(state.route);
  }, [state]);
  useEffect(() => {
    if (Platform.OS === 'web') {
      window.history.replaceState({ solveflowNavigation: state.key }, '', window.location.href);
      const pop = (event: PopStateEvent) => { const value: unknown = event.state; if (typeof value === 'object' && value !== null && 'solveflowNavigation' in value && typeof value.solveflowNavigation === 'number' && state.restore(value.solveflowNavigation)) setRoute(state.route); };
      window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
    }
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      const result = state.back(Date.now());
      if (result === 'page') setRoute(state.route);
      else if (result === 'hint') ToastAndroid.show('再按一次返回退出', ToastAndroid.SHORT);
      else BackHandler.exitApp();
      return true;
    });
    const app = AppState.addEventListener('change', () => state.resetExit());
    return () => { back.remove(); app.remove(); };
  }, [state]);
  return { route, current: current.current, navigate, forgetRecords, resetExit: () => state.resetExit() };
}
