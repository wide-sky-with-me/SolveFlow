import { Text, View, AnimatedView } from '../theme/primitives';
import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, StyleSheet } from 'react-native';
import type { RunView } from '@solveflow/contracts/http';
import { Button, colors, Notice, s } from './ui';
import { useReducedMotion } from './use-reduced-motion';

const stages = ['识题', '解答', '核对'];
const titles: Partial<Record<RunView['status'], string>> = {
  queued: '正在准备解题', understanding: '正在识别题目', solving: '正在解题',
  verifying: '正在独立校验', revising: '正在修正并再次核对',
};

/** Activity is animated; stage completion only follows actual run events. */
export function SolveProgress({ status, busy, connection, onCancel, onRefresh }: {
  status: RunView['status']; busy: boolean; connection: string; onCancel: () => void; onRefresh: () => void;
}) {
  const reduced = useReducedMotion();
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const motion = useRef(new Animated.Value(0)).current;
  const stage = status === 'verifying' || status === 'revising' ? 2 : status === 'solving' ? 1 : 0;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    motion.setValue(0);
    if (reduced || !foreground) return;
    const loop = Animated.loop(Animated.timing(motion, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true, isInteraction: false }));
    loop.start();
    return () => loop.stop();
  }, [motion, reduced, foreground]);
  const pulse = motion.interpolate({ inputRange: [0, .5, 1], outputRange: [.4, 1, .4] });
  return <View testID="solve-progress" style={styles.card}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.art}>
      <AnimatedView style={[styles.halo, { opacity: reduced ? 1 : pulse, transform: [{ scale: reduced ? 1 : motion.interpolate({ inputRange: [0, .5, 1], outputRange: [.94, 1.04, .94] }) }] }]} />
      <View style={styles.backPaper} />
      <View style={styles.paper}>
        <View style={styles.paperHeading} />
        {[0, 1, 2].map(index => <View key={index} style={[styles.lineTrack, { width: index === 2 ? 26 : 40 }]}>
          <AnimatedView style={[styles.line, { opacity: reduced ? .7 : motion.interpolate({ inputRange: [0, .12 + index * .16, .32 + index * .16, .9, 1], outputRange: [.15, .15, 1, 1, .15] }) }]} />
        </View>)}
        {!reduced && <AnimatedView testID="solve-scan" style={[styles.scan, { opacity: motion.interpolate({ inputRange: [0, .1, .85, 1], outputRange: [0, 1, 1, 0] }), transform: [{ translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [8, 78] }) }] }]} />}
      </View>
      <View style={styles.badge}><Text style={styles.badgeText}>{stage === 2 ? '⋯' : '✦'}</Text></View>
    </View>
    <View style={styles.caption}>
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>{titles[status] ?? '正在读取结果'}</Text>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dots}>
        {[0, 1, 2].map(index => <AnimatedView key={index} style={[styles.dot, { opacity: reduced ? .55 : motion.interpolate({ inputRange: [0, .15 + index * .2, .35 + index * .2, 1], outputRange: [.25, 1, .25, .25] }) }]} />)}
      </View>
    </View>
    <View accessibilityRole="progressbar" accessibilityLabel="解题进度" aria-valuetext={titles[status] ?? '正在读取结果'} style={styles.stages}>
      {stages.map((label, index) => <View key={label} style={styles.stage}>
        <View style={styles.track}><AnimatedView style={[styles.fill, { backgroundColor: index <= stage ? colors.blue : colors.line, opacity: index === stage && !reduced ? pulse : 1 }]} /></View>
        <Text style={[styles.stageText, index === stage && styles.activeText]}>{label}</Text>
      </View>)}
    </View>
    {connection ? <><Notice text={connection} /><Button title="刷新进度" secondary onPress={onRefresh} /></> : null}
    <View style={styles.actions}><Button title="取消本次解题" secondary disabled={busy} onPress={onCancel} /></View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#e7ecf3', paddingHorizontal: 22, paddingVertical: 24, gap: 18, alignItems: 'stretch' },
  art: { height: 126, width: 152, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: '#f0f5ff' },
  backPaper: { position: 'absolute', width: 67, height: 84, borderRadius: 12, backgroundColor: '#dbe8ff', transform: [{ rotate: '-12deg' }, { translateX: -7 }] },
  paper: { width: 68, height: 88, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#9bbcff', padding: 13, gap: 9, overflow: 'hidden' },
  paperHeading: { width: 16, height: 5, backgroundColor: colors.blue, borderRadius: 3, marginBottom: 3 },
  lineTrack: { height: 4, borderRadius: 2, backgroundColor: '#edf3ff' }, line: { ...StyleSheet.absoluteFill, backgroundColor: '#6695ec', borderRadius: 2 },
  scan: { position: 'absolute', left: 0, right: 0, top: 0, height: 9, backgroundColor: '#dbe8ff', borderBottomWidth: 1.5, borderBottomColor: '#82aafa' },
  badge: { position: 'absolute', right: 24, bottom: 13, width: 30, height: 30, borderRadius: 11, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' },
  badgeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  caption: { alignItems: 'center', gap: 10 }, title: { ...s.label, textAlign: 'center', fontSize: 17 },
  dots: { flexDirection: 'row', gap: 5 }, dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.blue },
  stages: { flexDirection: 'row', gap: 8, width: '100%', maxWidth: 320, alignSelf: 'center', marginTop: 4 }, stage: { flex: 1, gap: 9, alignItems: 'center' },
  track: { height: 3, width: '100%', backgroundColor: colors.line, borderRadius: 2, overflow: 'hidden' }, fill: { ...StyleSheet.absoluteFill, borderRadius: 2 },
  stageText: { fontSize: 12, color: colors.muted }, activeText: { color: colors.blue, fontWeight: '600' }, actions: { alignItems: 'center', marginTop: 2 },
});
