import { expect, it } from 'vitest';
import { browserNavigation, readBrowserNavigation } from './browser-navigation';
import { NavigationState } from './navigation-state';
const epoch = '96000000-0000-4000-8000-000000000001';
const questionId = '96000000-0000-4000-8000-000000000002';
it('preserves a section and its current question in a versioned browser entry', () => {
  const value = browserNavigation(epoch, 7, { page: 'profile' }, { page: 'current', questionId });
  expect(readBrowserNavigation(value)).toEqual(value);
  const nav = new NavigationState(readBrowserNavigation(value)!.route);
  expect(nav.route).toEqual({ page: 'profile' });
  expect(nav.key).toBe(0);
});
it('rejects legacy, malformed and expanded browser state before restoring navigation', () => {
  const good = browserNavigation(epoch, 1, { page: 'history' }, { page: 'current' });
  for (const bad of [null, { solveflowNavigation: 1 }, { ...good, epoch: 'bad' }, { ...good, key: -1 }, { ...good, key: 1.5 }, { ...good, schemaVersion: 2 }, { ...good, route: { page: 'current', questionId: 'bad' } }, { ...good, current: { page: 'profile' } }, { ...good, route: { page: 'history', image: 'unexpected' } }]) {
    expect(readBrowserNavigation(bad)).toBeNull();
  }
});
it('retains validated batch identity and rejects ambiguous question/batch targets', () => {
  const batch = { id: questionId, title: '合成批次', createdAt: '2026-10-07T00:00:00Z', exam: 'esat' as const, selectedId: questionId };
  const current = { page: 'current' as const, batch };
  const good = browserNavigation(epoch, 1, current, current);
  expect(readBrowserNavigation(good)).toEqual(good);
  expect(readBrowserNavigation({ ...good, route: { ...current, questionId } })).toBeNull();
  expect(readBrowserNavigation({ ...good, current: { ...current, batch: { ...batch, title: 'x'.repeat(101) } } })).toBeNull();
});
