import { expect, it } from 'vitest';
import { NavigationState } from './navigation-state';
it('forgets deleted questions and batches in both back and forward history without discarding browser keys', () => {
  const nav = new NavigationState(); nav.navigate({ page: 'current', questionId: 'deleted' }, true); const first = nav.key;
  nav.navigate({ page: 'history' }); const history = nav.key;
  nav.navigate({ page: 'current', batch: { id: 'batch', title: 'SAT', createdAt: '2026-09-21T00:00:00Z', exam: 'sat', selectedId: 'photo' } }); const batch = nav.key;
  nav.restore(history); nav.forgetRecords(new Set(['deleted', 'photo']), new Set(['batch']));
  expect(nav.route).toEqual({ page: 'history' });
  expect(nav.restore(first)).toBe(true); expect(nav.route).toEqual({ page: 'current' });
  expect(nav.restore(batch)).toBe(true); expect(nav.route).toEqual({ page: 'current' });
});
it('keeps the remaining batch when only its selected photo was deleted', () => {
  const nav = new NavigationState();
  const batch = { id: 'batch', title: 'SAT', createdAt: '2026-09-21T00:00:00Z', exam: 'sat' as const };
  nav.navigate({ page: 'current', batch: { ...batch, selectedId: 'photo' } });
  nav.forgetRecords(new Set(['photo']), new Set());
  expect(nav.route).toEqual({ page: 'current', batch });
});
it('returns a history question or batch to its source and then to the previous current question', () => {
  const nav = new NavigationState(); nav.navigate({ page: 'current', questionId: 'first' }, true);
  nav.navigate({ page: 'history' }); nav.navigate({ page: 'current', questionId: 'second' });
  expect(nav.back(100)).toBe('page'); expect(nav.route.page).toBe('history');
  expect(nav.back(200)).toBe('page'); expect(nav.route).toEqual({ page: 'current', questionId: 'first' });
  nav.navigate({ page: 'history' }); nav.navigate({ page: 'current', batch: { id: 'batch', title: 'SAT', createdAt: '2026-09-21T00:00:00Z', exam: 'sat' } });
  expect(nav.back(300)).toBe('page'); expect(nav.route.page).toBe('history');
});
it('requires two backs at root and resets the exit attempt after page navigation or backgrounding', () => {
  const nav = new NavigationState(); expect(nav.back(0)).toBe('hint'); expect(nav.back(2001)).toBe('hint'); expect(nav.back(2100)).toBe('exit');
  expect(nav.back(2200)).toBe('hint'); nav.navigate({ page: 'profile' }); nav.navigate({ page: 'favorites' });
  expect(nav.back(2300)).toBe('page'); expect(nav.route.page).toBe('profile'); expect(nav.back(2400)).toBe('page');
  expect(nav.back(2500)).toBe('hint'); nav.resetExit(); expect(nav.back(2600)).toBe('hint'); expect(nav.back(2700)).toBe('exit');
});
it('supports browser back and forward without building loops and bounds retained navigation entries', () => {
  const nav = new NavigationState(); nav.navigate({ page: 'history' }); const history = nav.key;
  nav.navigate({ page: 'current', questionId: 'a' }); const question = nav.key;
  expect(nav.restore(history)).toBe(true); expect(nav.route.page).toBe('history'); expect(nav.restore(question)).toBe(true); expect(nav.route.page).toBe('current');
  for (let i=0;i<60;i++) nav.navigate({ page: 'current', questionId: String(i) });
  let count=0; while (nav.canBack) { nav.back(0); count++; } expect(count).toBe(31);
});
