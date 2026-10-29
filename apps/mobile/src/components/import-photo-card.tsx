import { useState, type ReactNode } from 'react';
import type { ImportPhoto } from '../batch-photo-order';
import { Image, Pressable, Text, View } from '../theme/primitives';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';
import { s } from './ui';

export function ImportPhotoCard({ row, index, kind, summary, selected, disabled, testID, onSelect, onEdit, onRemove, wrapPreview }: {
  row: ImportPhoto; index: number; kind: 'new' | 'material'; summary: string; selected: boolean; disabled: boolean; testID: string;
  onSelect: () => void; onEdit: () => void; onRemove: () => void; wrapPreview?: (preview: ReactNode) => ReactNode;
}) {
  const { scheme } = useTheme(); const palette = themeColors[scheme];
  const [editFocus, setEditFocus] = useState(false); const [deleteFocus, setDeleteFocus] = useState(false);
  const label = kind === 'new' ? '题图' : '补图';
  const preview = <Pressable accessibilityRole="button" accessibilityLabel={kind === 'new' ? `选择新图${index + 1}的位置` : `分配第${index + 1}张补图`} accessibilityState={{ selected }} disabled={disabled} onPress={onSelect}
    style={{ height: 96, width: '100%', padding: 6, gap: 4, borderRadius: 12 }}>
    <View style={{ height: 64, borderRadius: 7, overflow: 'hidden', backgroundColor: palette.background }}>
      <Image source={{ uri: row.photo.uri }} resizeMode="contain" accessibilityLabel={`${label}${index + 1}缩略图：${row.fileName}`} style={{ width: '100%', height: '100%' }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 3, top: 3, paddingHorizontal: 4, borderRadius: 4, backgroundColor: palette.surface }}><Text style={{ fontSize: 11, lineHeight: 16 }}>{kind === 'new' ? '新' : '补图'} {index + 1}</Text></View>
    </View>
    <Text numberOfLines={1} style={[s.subtitle, { fontSize: 12, lineHeight: 16, textAlign: 'center' }]}>{summary}</Text>
  </Pressable>;
  return <View testID={testID} style={{ width: 110, height: 132, borderRadius: 12, borderWidth: 1, borderColor: selected ? palette.accent : palette.line, backgroundColor: selected ? '#edf3ff' : palette.surface }}>
    {wrapPreview ? wrapPreview(preview) : preview}
    <Pressable accessibilityRole="button" accessibilityLabel={`编辑第${index + 1}张${label}`} disabled={disabled} hitSlop={4} onPress={onEdit} onFocus={() => setEditFocus(true)} onBlur={() => setEditFocus(false)}
      style={({ pressed }) => ({ minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: editFocus ? palette.accent : 'transparent', backgroundColor: pressed ? '#deebff' : 'transparent', opacity: disabled ? .4 : 1 })}>
      <Text style={{ fontSize: 12, lineHeight: 18, color: palette.accent }}>编辑图片</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`移除第${index + 1}张`} disabled={disabled} hitSlop={6} onPress={onRemove} onFocus={() => setDeleteFocus(true)} onBlur={() => setDeleteFocus(false)}
      style={({ pressed }) => ({ position: 'absolute', right: 0, top: 0, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: deleteFocus ? palette.accent : 'transparent', backgroundColor: pressed ? '#fff0ee' : palette.surface, opacity: disabled ? .4 : 1 })}>
      <Text accessible={false} style={{ fontSize: 22, lineHeight: 26, color: palette.muted }}>×</Text>
    </Pressable>
  </View>;
}
