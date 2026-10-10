import { useCallback, useRef } from 'react';

// Keep the DOM bridge callback identity stable while invoking the latest handler.
// Optional actions stay absent so the document retains its capability checks.
export function useDocumentAction<A extends unknown[], R>(action: (...args: A) => R): (...args: A) => R;
export function useDocumentAction<A extends unknown[], R>(action: ((...args: A) => R) | undefined): ((...args: A) => R) | undefined;
export function useDocumentAction<A extends unknown[], R>(action: ((...args: A) => R) | undefined) {
  const current = useRef(action); current.current = action;
  const stable = useCallback((...args: A) => current.current?.(...args), []);
  return action ? stable : undefined;
}
