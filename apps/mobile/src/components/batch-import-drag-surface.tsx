import type { ReactNode } from 'react';
import { View } from '../theme/primitives';
import type { ImportDragItemProps, ImportDragSurfaceProps } from './batch-import-drag-surface.types';

export const batchImportDragAvailable = false;
export function BatchImportDragSurface({ children }: ImportDragSurfaceProps) { return <View>{children}</View>; }
export function BatchImportDragItem({ children }: ImportDragItemProps) { return <View style={{ flexShrink: 0 }}>{children}</View>; }
export function BatchImportDragGrid({ children }: { children: ReactNode }) { return <View>{children}</View>; }
