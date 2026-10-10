import { createContext, useContext, useState, type ComponentProps } from 'react';

export type ReadingState = Record<string, boolean>;
export const ReadingMemory = createContext<{ state: ReadingState; update: (key: string, open: boolean) => void } | null>(null);
export function useReadingDisclosure(key: string) {
  const memory = useContext(ReadingMemory);
  const [local, setLocal] = useState(false);
  const open = memory ? memory.state[key] ?? false : local;
  const setOpen = (value: boolean) => { if (memory) memory.update(key, value); else setLocal(value); };
  return [open, setOpen] as const;
}
export function ReadingDetails({ stateKey, ...props }: ComponentProps<'details'> & { stateKey: string }) {
  const [open, setOpen] = useReadingDisclosure(stateKey);
  return <details {...props} open={open} onToggle={event => { if (event.currentTarget.open !== open) setOpen(event.currentTarget.open); }} />;
}
