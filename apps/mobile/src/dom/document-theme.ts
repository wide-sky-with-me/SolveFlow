import { useLayoutEffect } from 'react';
export type DocumentTheme = 'light' | 'dark';
export function useDocumentTheme(theme: DocumentTheme) {
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, [theme]);
}
