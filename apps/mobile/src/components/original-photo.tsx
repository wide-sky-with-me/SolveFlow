import { usePhotoDisplayUri } from '../photo-display-cache';
import { themeColors } from '../theme/palette';
import { useTheme } from '../theme/provider';
import { Image, Pressable, Text, View } from '../theme/primitives';
import { useImageShare } from './use-image-share';
/** A photo itself is the viewer entry, including when answer rendering fails. */
export function OriginalPhoto({ uri, onPress }: { uri: string; onPress: () => void }) {
  const { scheme } = useTheme();
  const displayUri = usePhotoDisplayUri(uri);
  const { share, error } = useImageShare(uri);
  return <View><Pressable accessibilityRole="button" accessibilityLabel="查看题目图片" onPress={onPress} onLongPress={() => void share()} accessibilityHint="点击查看大图，长按分享图片" style={{ width: 88, height: 88, borderRadius: 8, overflow: 'hidden', backgroundColor: scheme === 'dark' ? '#1e293b' : themeColors.light.background }}>
    <Image source={{ uri: displayUri }} accessibilityLabel="题目原照片" resizeMode="contain" style={{ width: '100%', height: '100%' }} />
  </Pressable>{!!error && <Text accessibilityRole="alert">{error}</Text>}</View>;
}
