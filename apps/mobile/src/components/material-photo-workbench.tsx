import { useState } from 'react';
import type { ImportPhoto } from '../batch-photo-order';
import type { MaterialImportActions } from './material-import.types';
import { View } from '../theme/primitives';
import { ImportPhotoCard } from './import-photo-card';
import { MaterialPhotoTools } from './material-photo-tools';

/** The single-question import uses the same cards and on-demand tools as shared materials. */
export function MaterialPhotoWorkbench({ rows, busy, actions }: { rows: readonly ImportPhoto[]; busy: boolean; actions: MaterialImportActions }) {
  const [selected, setSelected] = useState<number>(); const [toolsId, setToolsId] = useState<number>();
  const tools = rows.find(row => row.id === toolsId); const index = rows.findIndex(row => row.id === toolsId);
  return <>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{rows.map((row, index) => <ImportPhotoCard key={row.id} row={row} index={index} kind="material" summary="" selected={row.id === (selected ?? rows[0]?.id)} disabled={busy} testID="material-import-row"
      onSelect={() => setSelected(row.id)} onEdit={() => { setSelected(row.id); setToolsId(row.id); }} onRemove={() => actions.remove(row)} />)}</View>
    {tools && <MaterialPhotoTools row={tools} index={index} busy={busy} onClose={() => setToolsId(undefined)} onCrop={() => { setToolsId(undefined); actions.crop(tools.id); }} onRotate={() => actions.rotate(tools)} />}
  </>;
}
