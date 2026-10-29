import { useEffect, useRef, useState } from 'react';
import { FlatList } from 'react-native';
import type { ImportPhoto } from '../batch-photo-order';
import type { MaterialTarget } from '../batch-material-selection';
import { Text, View } from '../theme/primitives';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';
import { MaterialTargetControl } from './material-target-control';
import { MaterialTargetGrid } from './material-target-grid';
import { MaterialPhotoTools } from './material-photo-tools';
import { ImportPhotoCard } from './import-photo-card';
import type { MaterialImportActions } from './material-import.types';
import { s } from './ui';

export function BatchMaterialWorkbench({ rows, targets, assignments, busy, onAssign, onPreview, actions }: {
  rows: readonly ImportPhoto[]; targets: readonly MaterialTarget[]; assignments: Readonly<Record<number, string[]>>; busy: boolean;
  onAssign: (id: number, ids: string[]) => void; onPreview: (id: string) => void;
  actions: MaterialImportActions;
}) {
  const [selectedId, setSelectedId] = useState<number>(); const [toolsId, setToolsId] = useState<number>();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const list = useRef<FlatList<ImportPhoto>>(null);
  useEffect(() => {
    if (actions.addedId === undefined) return;
    setSelectedId(actions.addedId); setFocusedId(null); setToolsId(undefined);
    const index = rows.findIndex(row => row.id === actions.addedId);
    const frame = requestAnimationFrame(() => { if (index >= 0) list.current?.scrollToOffset({ offset: index * 118, animated: false }); });
    return () => cancelAnimationFrame(frame);
  }, [actions.addedId]);
  const { scheme } = useTheme(); const palette = themeColors[scheme];
  const row = rows.find(item => item.id === selectedId) ?? rows[0];
  const ids = new Set(row ? assignments[row.id] ?? [] : []);
  const selectedTargets = targets.filter(target => ids.has(target.id));
  const tools = rows.find(item => item.id === toolsId); const toolsIndex = rows.findIndex(item => item.id === toolsId);
  function assign(values: string[]) { if (row && !busy) onAssign(row.id, values); }
  return <View style={{ gap: 14 }}>
    <FlatList ref={list} horizontal data={rows} keyExtractor={item => String(item.id)} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={3} extraData={{ selectedId: row?.id, assignments, busy }} contentContainerStyle={{ gap: 8 }}
      renderItem={({ item, index }) => <ImportPhotoCard row={item} index={index} kind="material" summary={`已绑定 ${assignments[item.id]?.length ?? 0} 题`} testID="material-import-row" selected={item.id === row?.id} disabled={busy}
        onSelect={() => { setSelectedId(item.id); setFocusedId(null); }} onEdit={() => { setSelectedId(item.id); setFocusedId(null); setToolsId(item.id); }} onRemove={() => actions.remove(item)} />} />
    {row && <>
      <Text testID="batch-material-assignment-summary" numberOfLines={2} style={s.subtitle}>{ids.size ? `对应 ${ids.size} 张题图：${selectedTargets.map(target => target.position).join('、')}` : '尚未选择对应题图'}</Text>
      <MaterialTargetGrid selectionKey={row.id} disabled={busy} ids={targets.map(target => target.id)} selected={[...ids]} onChange={assign}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {targets.map(target => <View key={target.id} testID="batch-material-target" style={{ width: 56, height: 56, borderRadius: 12, borderWidth: 1, borderColor: focusedId === target.id ? palette.accent : palette.line, backgroundColor: ids.has(target.id) ? '#edf3ff' : palette.surface, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialTargetControl id={target.id} label={`第${target.position}张题图`} checked={ids.has(target.id)} disabled={busy} onPreview={() => { if (!busy) onPreview(target.id); }}
              onFocus={() => setFocusedId(target.id)} onBlur={() => setFocusedId(current => current === target.id ? null : current)} onPress={() => { if (busy) return; const next = new Set(ids); if (next.has(target.id)) next.delete(target.id); else next.add(target.id); assign(targets.filter(item => next.has(item.id)).map(item => item.id)); setFocusedId(target.id); }}>
              <View style={{ width: 46, height: 48, borderRadius: 10, borderWidth: 1.5, borderColor: ids.has(target.id) ? palette.accent : palette.muted, backgroundColor: ids.has(target.id) ? palette.accent : palette.surface, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: ids.has(target.id) ? palette.background : palette.ink, fontWeight: '600', fontSize: 16 }}>{target.position}</Text></View>
            </MaterialTargetControl>
          </View>)}
        </View>
      </MaterialTargetGrid>
    </>}
    {tools && <MaterialPhotoTools row={tools} index={toolsIndex} busy={busy} onClose={() => setToolsId(undefined)} onCrop={() => { setToolsId(undefined); actions.crop(tools.id); }} onRotate={() => actions.rotate(tools)} />}
  </View>;
}
