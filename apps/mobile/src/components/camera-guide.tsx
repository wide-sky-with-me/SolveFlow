import { StyleSheet, Text, View } from 'react-native';

// Camera overlays keep their contrast against live pixels in either app theme.
// They are framing guides only: capture still saves the complete camera image.
export function CameraGuide({ message, busy }: { message: string; busy: boolean }) {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.frame}>
      {(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).map(corner => <View key={corner} style={[styles.corner, styles[corner]]}>
        <View style={[styles.outline, styles[corner]]} />
        <View style={[styles.edge, styles[corner]]} />
      </View>)}
    </View>
    <View style={styles.statusArea}>
      <View style={styles.status}>
        <View accessible={false} style={[styles.dot, busy && styles.busyDot]} />
        <Text numberOfLines={1} accessibilityLiveRegion="polite" style={styles.label}>{message}</Text>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: '14%', bottom: '18%', left: 24, right: 24 },
  corner: { position: 'absolute', width: 30, height: 30 },
  outline: { position: 'absolute', width: 32, height: 32, margin: -1, borderColor: 'rgba(0, 0, 0, 0.32)', borderWidth: 5 },
  edge: { position: 'absolute', width: 30, height: 30, borderColor: 'rgba(255, 255, 255, 0.96)', borderWidth: 2.5 },
  topLeft: { top: 0, left: 0, borderTopLeftRadius: 12, borderRightWidth: 0, borderBottomWidth: 0 },
  topRight: { top: 0, right: 0, borderTopRightRadius: 12, borderLeftWidth: 0, borderBottomWidth: 0 },
  bottomLeft: { bottom: 0, left: 0, borderBottomLeftRadius: 12, borderRightWidth: 0, borderTopWidth: 0 },
  bottomRight: { bottom: 0, right: 0, borderBottomRightRadius: 12, borderLeftWidth: 0, borderTopWidth: 0 },
  statusArea: { position: 'absolute', bottom: 16, left: 12, right: 12, alignItems: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', minHeight: 34, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(15, 23, 38, 0.76)' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' },
  busyDot: { backgroundColor: '#8bb8ff' },
  label: { flexShrink: 1, color: '#fff', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
