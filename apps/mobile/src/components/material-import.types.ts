import type { ReactNode } from 'react';
import type { ImportPhoto } from '../batch-photo-order';

export type MaterialImportActions = {
  crop: (id: number) => void;
  rotate: (row: ImportPhoto) => void;
  remove: (row: ImportPhoto) => void;
  addedId?: number;
};
export type MaterialWorkbench = (rows: readonly ImportPhoto[], busy: boolean, actions: MaterialImportActions) => ReactNode;
