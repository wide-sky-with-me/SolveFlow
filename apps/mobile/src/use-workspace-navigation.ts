import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, ToastAndroid } from 'react-native';
import { browserNavigation, readBrowserNavigation } from './browser-navigation';
import { forgetCurrentRecords, NavigationState, type CurrentPage, type WorkspacePage } from './navigation-state';
export function useWorkspaceNavigation() {
  const [initial] = useState(() => Platform.OS === 'web' ? readBrowserNavigation(window.history.state) : null);
  const state = useRef(new NavigationState(initial?.route)).current;
  const [epoch] = useState(() => Platform.OS === 'web' ? window.crypto.randomUUID() : '');
  const [route, setRoute] = useState(state.route); const current = useRef<CurrentPage>(initial?.current ?? { page: 'current' });
  if (route.page === 'current') current.current = route;
  const navigate = useCallback((next: WorkspacePage, replace = false) => {
    if (!state.navigate(next, replace)) return;
    if (state.route.page === 'current') current.current = state.route;
    if (Platform.OS === 'web') window.history[replace ? 'replaceState' : 'pushState'](browserNavigation(epoch, state.key, state.route, current.current), '', window.location.href);
    setRoute(state.route);
  }, [state, epoch]);
  const forgetRecords = useCallback((records: ReadonlySet<string>, batches: ReadonlySet<string>) => {
    state.forgetRecords(records, batches);
    current.current = forgetCurrentRecords(current.current, records, batches);
    if (Platform.OS === 'web') window.history.replaceState(browserNavigation(epoch, state.key, state.route, current.current), '', window.location.href);
    setRoute({ ...state.route });
  }, [state, epoch]);
  useEffect(() => {
    if (Platform.OS === 'web') {
      window.history.replaceState(browserNavigation(epoch, state.key, state.route, current.current), '', window.location.href);
      const pop = (event: PopStateEvent) => {
        const value = readBrowserNavigation(event.state);
        if (!value) return;
        if (value.epoch !== epoch || !state.restore(value.key)) {
          state.navigate(value.route);
          current.current = value.current;
        }
        if (state.route.page === 'current') current.current = state.route;
        window.history.replaceState(browserNavigation(epoch, state.key, state.route, current.current), '', window.location.href);
        setRoute(state.route);
      };
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
  }, [state, epoch]);
  return { route, current: current.current, navigate, forgetRecords, resetExit: () => state.resetExit() };
}
