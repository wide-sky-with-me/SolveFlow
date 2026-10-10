import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';

const PageReady = createContext<((ready: boolean) => void) | null>(null);
/** A requested offscreen page still needs its document timeout to run. */
export const QuestionPageRequested = createContext(true);

export function QuestionPageReady({ pageKey, onReady, children }: { pageKey: string; onReady: (key: string, ready: boolean) => void; children: ReactNode }) {
  const report = useCallback((ready: boolean) => onReady(pageKey, ready), [pageKey, onReady]);
  useEffect(() => () => report(false), [report]);
  return <PageReady value={report}>{children}</PageReady>;
}

/** null delegates readiness to the nested reader/document. */
export function useQuestionPageReady(ready: boolean | null) {
  const report = useContext(PageReady);
  useEffect(() => {
    if (ready !== null) report?.(ready);
  }, [ready, report]);
}
