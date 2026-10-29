// Decision: .agents/notes/implemented/storage/2026-10-25-continuous-capture-buffer.md
import { useEffect } from 'react';

export function useCaptureExitGuard(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [pending]);
}
