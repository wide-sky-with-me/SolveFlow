import { useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import type { ImportPhoto } from '../batch-photo-order';
import { Image, Pressable, ScrollView, Text } from '../theme/primitives';
import { BatchImportDialog } from './batch-import-dialog';
import { ImageViewer } from './image-viewer';
import { Button, layout, s } from './ui';

export function MaterialPhotoTools({ row, index, busy, onClose, onCrop, onRotate, kind = '补图', extraActions }: {
  row: ImportPhoto; index: number; busy: boolean; onClose: () => void; onCrop: () => void; onRotate: () => void; kind?: '题图' | '补图'; extraActions?: ReactNode;
}) {
  const [view, setView] = useState(false);
  const { height } = useWindowDimensions();
  return <>
    <BatchImportDialog testID={kind === '补图' ? 'material-photo-tools' : 'import-photo-tools'} title={`${kind} ${index + 1}`} closeTitle="关闭图片操作" maxWidth={layout.dialogWidth} busy={busy} onClose={onClose}
      footer={<>{extraActions}<Button title={`裁剪第${index + 1}张`} compact secondary disabled={busy} onPress={onCrop} /><Button title={`旋转第${index + 1}张`} compact secondary disabled={busy} onPress={onRotate} /></>}>
      <ScrollView style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text numberOfLines={1} style={s.subtitle}>{row.fileName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看${kind}${index + 1}`} disabled={busy} onPress={() => setView(true)}>
          <Image source={{ uri: row.photo.uri }} resizeMode="contain" accessibilityLabel={`${kind}预览${index + 1}`} style={{ width: '100%', height: Math.max(60, Math.min(180, height - 320)), borderRadius: 12 }} />
        </Pressable>
      </ScrollView>
    </BatchImportDialog>
    {view && <ImageViewer uri={row.photo.uri} size={row.photo} onClose={() => setView(false)} />}
  </>;
}
