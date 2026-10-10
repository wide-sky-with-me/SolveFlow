import { Text, View } from '../theme/primitives';
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { colors } from './ui';
/** Lightweight native artwork: stays sharp and offline on all screen sizes. */
export function EmptyState({ kind, title, description, children }: { kind: 'camera' | 'history' | 'favorites'; title: string; description?: string; children: ReactNode }) {
  const window = useWindowDimensions();
  const shortLandscape = window.height < 500 && window.width > window.height;
  return <View style={[styles.panel, shortLandscape && styles.shortPanel]} testID={`empty-${kind}`}>
    <View testID="empty-art" style={[styles.artSlot, shortLandscape && styles.shortArtSlot]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    <View style={[styles.art, shortLandscape && styles.shortArt]}>
      <View style={[styles.orbit, kind === 'favorites' && { backgroundColor: '#fff3d9' }]} />
      <View style={[styles.dot, { left: 25, top: 30 }]} /><View style={[styles.dot, { right: 16, bottom: 26, width: 7, height: 7, backgroundColor: '#bdd8ee' }]} />
      <View style={styles.backPage} /><View style={styles.page}><View style={styles.lineShort} /><View style={styles.line} /><View style={styles.line} /><View style={[styles.line, { width: 32 }]} /></View>
      <View style={[styles.badge, kind === 'favorites' && { backgroundColor: '#e6ad42' }]}>{kind === 'favorites' ? <Text style={styles.star}>★</Text> : kind === 'history' ? <View style={styles.clock}><View style={styles.hand} /><View style={styles.minute} /></View> : <View style={styles.camera}><View style={styles.lens} /></View>}</View>
    </View>
    </View>
    <View testID="empty-body" style={[styles.body, shortLandscape && styles.shortBody]}>
      <Text accessibilityRole="header" style={[styles.title, shortLandscape && styles.shortText]}>{title}</Text>
      {!!description && <Text testID="empty-description" style={[styles.description, shortLandscape && styles.shortText]}>{description}</Text>}
      <View style={[styles.actions, shortLandscape && styles.shortActions]}>{children}</View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  panel: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20, borderRadius: 24, backgroundColor: '#f8faff', width: '100%', gap: 12 },
  body: { alignItems: 'center', gap: 12, width: '100%' },
  shortPanel: { flexDirection: 'row', paddingVertical: 16, paddingHorizontal: 16, gap: 16 },
  shortBody: { flex: 1, width: 'auto', alignItems: 'flex-start', gap: 8 },
  shortText: { textAlign: 'left', maxWidth: '100%' },
  shortActions: { justifyContent: 'flex-start', marginTop: 4, gap: 8 },
  artSlot: { width: 194, height: 168, marginBottom: 10 },
  shortArtSlot: { width: 88, height: 76, marginBottom: 0, flexShrink: 0 },
  art: { width: 194, height: 168 },
  shortArt: { position: 'absolute', left: -53, top: -46, transform: [{ scale: .45 }] },
  orbit: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: '#eaf1ff', left: 22, top: 8 },
  dot: { position: 'absolute', width: 11, height: 11, borderRadius: 6, backgroundColor: '#d5e3ff' },
  backPage: { position: 'absolute', width: 78, height: 103, top: 29, left: 47, backgroundColor: '#c8dafa', borderRadius: 12, transform: [{ rotate: '-15deg' }] },
  page: { position: 'absolute', width: 84, height: 108, top: 23, left: 64, padding: 16, gap: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e1eaf9', borderRadius: 12, transform: [{ rotate: '8deg' }] },
  lineShort: { width: 24, height: 5, borderRadius: 3, backgroundColor: '#83aaf0', marginBottom: 5 }, line: { width: 48, height: 4, borderRadius: 2, backgroundColor: '#e1e9f6' },
  badge: { position: 'absolute', width: 46, height: 46, right: 29, bottom: 19, borderRadius: 17, backgroundColor: colors.blue, borderWidth: 3, borderColor: '#f8faff', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  star: { fontSize: 24, color: '#fff' }, camera: { width: 24, height: 18, borderWidth: 2, borderColor: '#fff', borderRadius: 5, alignItems: 'center', justifyContent: 'center' }, lens: { width: 9, height: 9, borderWidth: 2, borderColor: '#fff', borderRadius: 5 },
  clock: { width: 24, height: 24, borderWidth: 2, borderColor: '#fff', borderRadius: 12 }, hand: { position: 'absolute', width: 2, height: 7, backgroundColor: '#fff', left: 9, top: 4 }, minute: { position: 'absolute', width: 6, height: 2, backgroundColor: '#fff', left: 9, top: 10 },
  title: { color: colors.ink, fontSize: 18, fontWeight: '600', textAlign: 'center' }, description: { color: colors.muted, fontSize: 14, lineHeight: 23, textAlign: 'center', maxWidth: 260 }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 10 },
});
