import type { ReactNode } from 'react';
import type { BatchImportSlot } from '../batch-import-placement';
import type { BatchImportDragRequest } from '../batch-import-drag';

export type ImportDragSurfaceProps = {
  photoIds: readonly number[]; layout: readonly BatchImportSlot[]; group: boolean;
  onPreview: (request: BatchImportDragRequest | null) => void;
  onDrop: (request: BatchImportDragRequest) => void;
  onActiveChange: (active: boolean) => void;
  onSelect: (id: number) => void;
  children: ReactNode;
};
export type ImportDragItemProps = { source?: number | 'all' | undefined; target?: BatchImportSlot | null | undefined; children: ReactNode };
