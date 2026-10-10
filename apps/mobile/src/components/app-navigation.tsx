import { Pressable, View, AnimatedView, AnimatedText } from '../theme/primitives';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View as IconShape } from 'react-native';
import { colors, layout } from './ui';
import { useReducedMotion } from './use-reduced-motion';
import { AppBrand } from './app-brand';
import type { ExamType } from '@solveflow/contracts/local';

export type AppTab = 'questions' | 'profile';
const easing = Easing.bezier(.2, 0, 0, 1);
const interpolate = (value: Animated.Value, from: number, to: number) => value.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

/** Related outline/fill drawings share a 28px canvas, so the accent follows the icon itself. */
function TabIcon({ kind, progress }: { kind: AppTab; progress: Animated.Value }) {
  const incoming = progress.interpolate({ inputRange: [0, .2, 1], outputRange: [0, 0, 1] });
  return <View style={styles.icon} testID={`nav-icon-${kind}`}>
    <AnimatedView testID={`nav-outline-${kind}`} style={[styles.layer, { opacity: interpolate(progress, 1, 0) }]}>
      {kind === 'questions' ? <View style={styles.paper}><View style={styles.line} /><View style={[styles.line, styles.shortLine]} /></View> : <View style={styles.person}><View style={styles.head} /><View style={styles.shoulders} /></View>}
    </AnimatedView>
    <AnimatedView testID={`nav-fill-${kind}`} style={[styles.layer, { opacity: incoming }]}>
      {kind === 'questions' ? <>
        <AnimatedView style={[styles.backPaper, { transform: [{ translateX: interpolate(progress, 0, -2) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-12deg'] }) }] }]} />
        <View style={[styles.paper, styles.paperFilled]}>
          <Animated.View style={[styles.line, styles.whiteLine, { opacity: incoming, transform: [{ scaleX: interpolate(progress, .35, 1) }] }]} />
          <Animated.View style={[styles.line, styles.shortLine, styles.whiteLine, { opacity: progress.interpolate({ inputRange: [0, .45, 1], outputRange: [0, 0, 1] }), transform: [{ scaleX: interpolate(progress, .2, 1) }] }]} />
        </View>
      </> : <View style={styles.person}>
        <AnimatedView style={[styles.head, styles.headFilled, { transform: [{ scale: interpolate(progress, .8, 1) }] }]} />
        <AnimatedView style={[styles.shoulders, styles.shouldersFilled, { transform: [{ translateY: interpolate(progress, 2, 0) }] }]} />
      </View>}
    </AnimatedView>
  </View>;
}

function TabItem({ kind, label, selected, reduced, onPress }: { kind: AppTab; label: string; selected: boolean; reduced: boolean; onPress: () => void }) {
  const progress = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const touch = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.stopAnimation(); touch.stopAnimation(); touch.setValue(0);
    if (reduced) { progress.setValue(selected ? 1 : 0); return; }
    const animation = Animated.timing(progress, { toValue: selected ? 1 : 0, duration: 280, easing, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [selected, reduced, progress, touch]);
  useEffect(() => () => { progress.stopAnimation(); touch.stopAnimation(); }, [progress, touch]);
  function feedback(down: boolean) {
    touch.stopAnimation();
    if (reduced) { touch.setValue(0); return; }
    Animated.timing(touch, { toValue: down ? 1 : 0, duration: down ? 90 : 180, easing, useNativeDriver: true }).start();
  }
  return <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} aria-selected={selected} onPressIn={() => feedback(true)} onPressOut={() => feedback(false)} onPress={onPress} style={styles.item}>
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.content}>
      <AnimatedView testID={`nav-touch-${kind}`} style={{ opacity: interpolate(touch, 1, .65) }}><TabIcon kind={kind} progress={progress} /></AnimatedView>
      <View style={styles.labelSlot}>
        <AnimatedText style={[styles.label, { opacity: interpolate(progress, 1, 0) }]}>{label}</AnimatedText>
        <AnimatedText style={[styles.label, styles.selectedLabel, { opacity: progress }]}>{label}</AnimatedText>
      </View>
    </View>
  </Pressable>;
}

function CameraItem({ disabled, reduced, onPress }: { disabled: boolean; reduced: boolean; onPress: () => void }) {
  const shutter = useRef(new Animated.Value(0)).current;
  useEffect(() => { shutter.stopAnimation(); shutter.setValue(0); return () => shutter.stopAnimation(); }, [disabled, reduced, shutter]);
  function feedback(down: boolean) {
    shutter.stopAnimation();
    if (disabled || reduced) { shutter.setValue(0); return; }
    Animated.timing(shutter, { toValue: down ? 1 : 0, duration: down ? 140 : 240, easing, useNativeDriver: true }).start();
  }
  return <Pressable accessibilityRole="button" accessibilityLabel="拍照" accessibilityState={{ disabled }} disabled={disabled} onPressIn={() => feedback(true)} onPressOut={() => feedback(false)} onPress={onPress} style={[styles.item, disabled && styles.disabled]}>
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.captureCircle}>
      <AnimatedView style={[styles.captureShade, { opacity: shutter }]} />
      {/* White strokes sit on the blue icon in both themes, not on a themed surface. */}
      <IconShape style={styles.camera}><IconShape style={styles.cameraTop} />
        <Animated.View testID="nav-camera-shutter" style={[styles.lens, { transform: [{ rotate: shutter.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) }] }]}>
          <Animated.View style={[styles.shutterBlade, { transform: [{ translateY: interpolate(shutter, -5, -1) }] }]} />
          <Animated.View style={[styles.shutterBlade, { transform: [{ translateY: interpolate(shutter, 5, 1) }] }]} />
        </Animated.View>
        <Animated.View style={[styles.cameraLight, { opacity: shutter }]} />
      </IconShape>
    </View>
  </Pressable>;
}

export function AppNavigation({ tab, exam = 'general', onTab, onCamera, cameraDisabled }: { tab: AppTab; exam?: ExamType; onTab: (tab: AppTab) => void; onCamera: () => void; cameraDisabled: boolean }) {
  const reduced = useReducedMotion();
  return <View testID="app-navigation" style={styles.bar} accessibilityLabel="主导航" role="navigation">
    <AppBrand exam={exam} />
    <View testID="navigation-items" style={styles.items}>
    <TabItem kind="questions" label="题目" selected={tab === 'questions'} reduced={reduced} onPress={() => onTab('questions')} />
    <CameraItem disabled={cameraDisabled} reduced={reduced} onPress={onCamera} />
    <TabItem kind="profile" label="我的" selected={tab === 'profile'} reduced={reduced} onPress={() => onTab('profile')} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  bar: { paddingVertical: 3, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: '#fff' },
  items: { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center', paddingHorizontal: 20 },
  item: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  content: { alignItems: 'center', gap: 1 },
  icon: { width: 28, height: 28 }, layer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  labelSlot: { width: 44, height: 17 }, label: { position: 'absolute', width: 44, textAlign: 'center', lineHeight: 17, color: colors.muted, fontSize: 12, fontWeight: '500' }, selectedLabel: { color: colors.blue },
  paper: { width: 18, height: 21, borderWidth: 1.8, borderColor: colors.muted, borderRadius: 4, justifyContent: 'center', paddingHorizontal: 3, gap: 4 },
  backPaper: { position: 'absolute', width: 18, height: 21, borderRadius: 4, backgroundColor: '#c2d7ff' },
  paperFilled: { backgroundColor: colors.blue, borderColor: colors.blue },
  line: { width: 9, height: 1.8, borderRadius: 1, backgroundColor: colors.muted }, shortLine: { width: 6 }, whiteLine: { backgroundColor: '#fff' },
  person: { width: 22, height: 23, alignItems: 'center', justifyContent: 'space-between' },
  head: { width: 9, height: 9, borderWidth: 1.8, borderColor: colors.muted, borderRadius: 6 }, headFilled: { backgroundColor: colors.blue, borderColor: colors.blue },
  shoulders: { width: 21, height: 11, borderWidth: 1.8, borderColor: colors.muted, borderTopLeftRadius: 11, borderTopRightRadius: 11, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }, shouldersFilled: { borderColor: colors.blue, backgroundColor: '#d9e6ff' },
  captureCircle: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  captureShade: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#1748b4' },
  camera: { width: 23, height: 18, borderWidth: 2, borderRadius: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }, cameraTop: { position: 'absolute', top: -5, width: 12, height: 5, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: '#fff' },
  lens: { width: 10, height: 10, borderWidth: 1.6, borderColor: '#fff', borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  shutterBlade: { position: 'absolute', width: 10, height: 5, backgroundColor: '#fff' }, cameraLight: { position: 'absolute', right: 1, top: 1, width: 2, height: 2, borderRadius: 1, backgroundColor: '#fff' }, disabled: { opacity: .45 },
});
