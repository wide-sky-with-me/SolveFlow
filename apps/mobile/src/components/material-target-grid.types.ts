import type { ReactNode } from 'react';

export interface MaterialTargetGridProps {
  selectionKey: number;
  disabled: boolean;
  ids: readonly string[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  children: ReactNode;
}
