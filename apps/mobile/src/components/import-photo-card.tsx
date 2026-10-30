import { useState, type ReactNode } from 'react';
import type { ImportPhoto } from '../batch-photo-order';
import { Pressable, Text, View } from '../theme/primitives';
import { ImportPhotoPreview } from './import-photo-preview';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';
import { s } from './ui';
export const PHOTO_CARD_HEIGHT = 132;

export function ImportPhotoCard({ row, index, kind, summary, selected, disabled, testID, onSelect, onEdit, onRemove, wrapPreview }: {
  row: ImportPhoto; index: number; kind: 'new' | 'material'; summary: string; selected: boolean; disabled: boolean; testID: string;
  onSelect: () => void; onEdit: () => void; onRemove: () => void; wrapPreview?: (preview: ReactNode) => ReactNode;
}) {
  const label = kind === 'new' ? '题图' : '补图';
  return <PhotoCard preview={<ImportPhotoPreview photo={row.photo} label={`${label}${index + 1}缩略图：${row.fileName}`} />} tag={`${kind === 'new' ? '新' : '补图'} ${index + 1}`} summary={summary} selected={selected} disabled={disabled} testID={testID}
    selectLabel={kind === 'new' ? `选择新图${index + 1}的位置` : `分配第${index + 1}张补图`} editLabel={`编辑第${index + 1}张${label}`} removeLabel={`移除第${index + 1}张`} onSelect={onSelect} onEdit={onEdit} onRemove={onRemove} wrapPreview={wrapPreview} />;
}

export function PhotoCard({ preview: contents, tag, summary, selected, disabled, testID, selectLabel, editLabel, removeLabel, editTitle = '编辑图片', onSelect, onEdit, onRemove, wrapPreview }: {
  preview: ReactNode; tag?: string; summary: string; selected: boolean; disabled: boolean; testID: string; selectLabel: string; editLabel: string; removeLabel: string; editTitle?: string;
  onSelect: () => void; onEdit: () => void; onRemove: () => void; wrapPreview?: ((preview: ReactNode) => ReactNode) | undefined;
}) {
  const { scheme } = useTheme(); const palette = themeColors[scheme];
  const [editFocus, setEditFocus] = useState(false); const [deleteFocus, setDeleteFocus] = useState(false);
  const preview = <Pressable accessibilityRole="button" accessibilityLabel={selectLabel} accessibilityState={{ selected }} disabled={disabled} onPress={onSelect}
    style={{ height: summary ? 96 : 78, width: '100%', padding: 6, gap: 4, borderRadius: 12 }}>
    <View style={{ height: 64, borderRadius: 7, overflow: 'hidden', backgroundColor: palette.background }}>
      {contents}
      {tag && <View pointerEvents="none" style={{ position: 'absolute', left: 3, top: 3, paddingHorizontal: 4, borderRadius: 4, backgroundColor: palette.surface }}><Text style={{ fontSize: 11, lineHeight: 16 }}>{tag}</Text></View>}
    </View>
    {!!summary && <Text numberOfLines={1} style={[s.subtitle, { fontSize: 12, lineHeight: 16, textAlign: 'center' }]}>{summary}</Text>}
  </Pressable>;
  return <View testID={testID} style={{ width: 110, height: summary ? PHOTO_CARD_HEIGHT : 114, borderRadius: 12, borderWidth: 1, borderColor: selected ? palette.accent : palette.line, backgroundColor: selected ? '#edf3ff' : palette.surface }}>
    {wrapPreview ? wrapPreview(preview) : preview}
    <Pressable accessibilityRole="button" accessibilityLabel={editLabel} disabled={disabled} hitSlop={4} onPress={onEdit} onFocus={() => setEditFocus(true)} onBlur={() => setEditFocus(false)}
      style={({ pressed }) => ({ minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: editFocus ? palette.accent : 'transparent', backgroundColor: pressed ? '#deebff' : 'transparent', opacity: disabled ? .4 : 1 })}>
      <Text style={{ fontSize: 12, lineHeight: 18, color: palette.accent }}>{editTitle}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={removeLabel} disabled={disabled} hitSlop={6} onPress={onRemove} onFocus={() => setDeleteFocus(true)} onBlur={() => setDeleteFocus(false)}
      style={({ pressed }) => ({ position: 'absolute', right: 0, top: 0, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: deleteFocus ? palette.accent : 'transparent', backgroundColor: pressed ? '#fff0ee' : palette.surface, opacity: disabled ? .4 : 1 })}>
      <Text accessible={false} style={{ fontSize: 22, lineHeight: 26, color: palette.muted }}>×</Text>
    </Pressable>
  </View>;
}
