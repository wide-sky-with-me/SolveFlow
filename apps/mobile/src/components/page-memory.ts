import { createContext, useContext, useState } from 'react';
import type { RunContext } from '@solveflow/contracts/http';

type ThreadState = { text: string; focus: { context: RunContext; label: string } | null; selectedRunId: string | null; latestId: string | undefined };
/** Small UI state belongs to the reader, never a global photo/answer cache. */
export function createPageMemory() {
  return { threads: new Map<string, ThreadState>(), selections: new Map<string, string>(), scroll: new Map<string, number>(), documents: new Map<string, Record<string, boolean>>() };
}
export const PageMemory = createContext<ReturnType<typeof createPageMemory> | null>(null);
export function useThreadMemory(key: string) {
  const memory = useContext(PageMemory);
  const [state, setState] = useState<ThreadState>(() => memory?.threads.get(key) ?? { text: '', focus: null, selectedRunId: null, latestId: undefined });
  function update(patch: Partial<ThreadState>) {
    setState(previous => {
      const next = { ...previous, ...patch };
      memory?.threads.set(key, next);
      return next;
    });
  }
  return [state, update] as const;
}
