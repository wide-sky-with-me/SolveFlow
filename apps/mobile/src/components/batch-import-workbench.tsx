import { useState } from 'react';
import { FlatList } from 'react-native';
import type { ImportPhoto } from '../batch-photo-order';
import { batchImportLayout, numberBatchImportLayout, type BatchImportSlot, type ExistingBatchImage } from '../batch-import-placement';
import { moveBatchImportPhotos, type BatchImportDragRequest } from '../batch-import-drag';
import { BatchImportDragSurface, BatchImportDragItem, BatchImportDragGrid, batchImportDragAvailable } from './batch-import-drag-surface';
import { Pressable, Text, View } from '../theme/primitives';
import { Button, colors, s } from './ui';
import { ImportPhotoCard } from './import-photo-card';
import { MaterialPhotoTools } from './material-photo-tools';

export function BatchImportWorkbench({ existing, photos, layout, selectedId, beforeId, dragging, busy, onSelect, onPlace, onMove, onRemove, onCrop, onRotate, onDrop, onDragActive }: {
  existing: ExistingBatchImage[]; photos: ImportPhoto[]; layout: BatchImportSlot[];
  selectedId: number; beforeId: string | null; onSelect: (id: number) => void; onPlace: (beforeId: string | null, all?: boolean) => void;
  onMove: (index: number, delta: -1 | 1) => void; onRemove: (id: number) => void;
  dragging: boolean; busy: boolean; onCrop: (id: number) => void; onRotate: (row: ImportPhoto) => void;
  onDrop: (request: BatchImportDragRequest) => void; onDragActive: (active: boolean) => void;
}) {
  const [group, setGroup] = useState(false); const [preview, setPreview] = useState<BatchImportDragRequest | null>(null);
  const [toolsId, setToolsId] = useState<number>();
  const tools = photos.find(row => row.id === toolsId); const toolsIndex = photos.findIndex(row => row.id === toolsId);
  const blocked = dragging || busy;
  const plan = preview ? moveBatchImportPhotos(photos, layout, preview.photoIds, preview.target) : null;
  const draft = plan ? batchImportLayout(existing, plan.orderedIds.map(id => ({ id })), plan.placements) : layout;
  const selected = photos.find(row => row.id === (preview?.photoIds[0] ?? selectedId)) ?? photos[0];
  const numbered = numberBatchImportLayout(existing, draft);
  const destination = numbered.find(row => row.kind === 'new' && row.photoId === selected?.id)?.position ?? 0;
  const anchor = plan && selected ? plan.placements.get(selected.id) ?? null : beforeId;
  const target = existing.find(row => row.id === anchor);
  const targetPosition = target ? numbered.find(row => row.kind === 'existing' && row.id === target.id)?.position ?? 0 : 0;
  const multiple = photos.length > 1;
  const selectedIndex = photos.findIndex(row => row.id === selected?.id);
  const positions = new Map(numbered.flatMap(row => row.kind === 'new' ? [[row.photoId, row.position]] : []));
  return <BatchImportDragSurface photoIds={busy ? [] : photos.map(row => row.id)} layout={layout} group={group} onPreview={setPreview} onDrop={onDrop} onActiveChange={onDragActive} onSelect={onSelect}><View testID="batch-import-workbench" style={{ gap: 16 }}>
    <View style={s.row}><Text style={[s.label, { flex: 1 }]}>待加入 · {photos.length} 张</Text>{multiple && <>
      {batchImportDragAvailable && <Pressable accessibilityRole="button" accessibilityLabel="整组拖动" aria-pressed={group} accessibilityState={{ selected: group, disabled: blocked }} disabled={blocked} onPress={() => setGroup(value => !value)} style={[s.button, s.compact, s.secondary, { borderColor: group ? colors.blue : colors.line, backgroundColor: group ? '#dbe8ff' : '#edf3ff' }]}><Text style={[s.buttonText, { color: colors.blue, fontSize: 13 }]}>整组拖动</Text></Pressable>}
      <Button title="全部追加到末尾" secondary compact disabled={blocked} onPress={() => onPlace(null, true)} /></>}</View>
    <FlatList horizontal data={photos} keyExtractor={row => String(row.id)} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={3} extraData={{ selectedId: selected?.id, positions, blocked }} contentContainerStyle={{ gap: 8 }}
      renderItem={({ item, index }) => <ImportPhotoCard row={item} index={index} kind="new" summary={`加入后第 ${positions.get(item.id)} 张`} testID="import-photo-row" selected={item.id === selected?.id} disabled={blocked}
        onSelect={() => onSelect(item.id)} onEdit={() => { onSelect(item.id); setToolsId(item.id); }} onRemove={() => onRemove(item.id)}
        wrapPreview={node => <BatchImportDragItem source={busy ? undefined : item.id}>{node}</BatchImportDragItem>} />} />
    {selected && <Text testID="batch-import-placement-summary" accessibilityLiveRegion="polite" style={s.subtitle}>{destination > 0 ? `新 ${selectedIndex + 1} → 第 ${destination} 张 · ${target && targetPosition > 0 ? `目标：第 ${targetPosition} 张（原第 ${target.position} 张）` : '追加到末尾'}` : '位置待确认'}</Text>}
    <View style={{ gap: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 }}>
      <View style={s.row}><Text style={[s.label, { flex: 1 }]}>调整后顺序 · 共 {layout.length} 张</Text>{multiple && <Button title="全部新图放到此处" secondary compact disabled={blocked} onPress={() => onPlace(beforeId, true)} />}</View>
      <BatchImportDragGrid><View testID="batch-import-layout" style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 10 }}>
        {numbered.map(row => {
          const incoming = row.kind === 'new';
          const photoIndex = incoming ? photos.findIndex(photo => photo.id === row.photoId) : -1;
          const original = row.kind === 'existing' ? existing.find(item => item.id === row.id) : undefined;
          const active = row.kind === 'new' && row.photoId === selected?.id;
          const ordinal = row.position;
          return <BatchImportDragItem key={row.kind === 'new' ? `new-${row.photoId}` : row.id} source={row.kind === 'new' ? row.photoId : undefined} target={row}><View style={{ flexDirection: 'row', alignItems: 'center', width: 62, height: 48 }}>
            <View style={{ width: 10, height: 48, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
              {active && <View testID="batch-import-insertion-cursor" style={{ width: 3, height: 42, backgroundColor: colors.blue, borderRadius: 2 }}><View style={{ position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: colors.blue, left: -2, top: -2 }} /></View>}
            </View>
            <Pressable testID={incoming ? 'batch-import-new-slot' : 'batch-import-existing-slot'} accessibilityRole="button" accessibilityLabel={incoming ? `第${ordinal}张（新图${photoIndex + 1}），选择调整位置` : `插到第${ordinal}张之前（原第${original?.position}张）`} accessibilityState={{ selected: active }} disabled={blocked}
              onPress={() => { if (row.kind === 'new') onSelect(row.photoId); else onPlace(row.id); }}
              style={({ pressed }) => ({ width: 52, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: active ? 2 : 1, borderColor: active ? colors.blue : incoming ? '#7ba7f0' : '#e7ecf3', backgroundColor: pressed ? '#dbe8ff' : incoming ? '#edf3ff' : '#f5f7fb' })}>
              <Text testID="batch-import-slot-number" style={{ fontSize: 16, lineHeight: 20, fontWeight: incoming ? '700' : '500', color: incoming ? colors.blue : colors.ink }}>{ordinal}</Text>
              {(incoming || original?.position !== ordinal) && <Text style={{ fontSize: 10, lineHeight: 12, color: incoming ? colors.blue : colors.muted }}>{incoming ? `新${photoIndex + 1}` : `原${original?.position}`}</Text>}
            </Pressable>
          </View></BatchImportDragItem>;
        })}
        <BatchImportDragItem target={null}><View style={{ width: 62, paddingLeft: 10 }}><Pressable accessibilityRole="button" accessibilityLabel="本张追加到末尾" onPress={() => onPlace(null)} style={{ width: 52, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: '#f5f7fb' }}><Text style={s.subtitle}>末尾</Text></Pressable></View></BatchImportDragItem>
      </View></BatchImportDragGrid>
    </View>
    {tools && <MaterialPhotoTools kind="题图" row={tools} index={toolsIndex} busy={busy} onClose={() => setToolsId(undefined)} onCrop={() => { setToolsId(undefined); onCrop(tools.id); }} onRotate={() => onRotate(tools)} extraActions={multiple ? <View style={s.row}><Button title={`上移第${toolsIndex + 1}张`} compact secondary disabled={busy || toolsIndex === 0} onPress={() => onMove(toolsIndex, -1)} /><Button title={`下移第${toolsIndex + 1}张`} compact secondary disabled={busy || toolsIndex === photos.length - 1} onPress={() => onMove(toolsIndex, 1)} /></View> : undefined} />}
  </View></BatchImportDragSurface>;
}
