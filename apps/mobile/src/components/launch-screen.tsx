import { Image, Text, View, AnimatedView } from '../theme/primitives';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet } from 'react-native';
import { colors } from './ui';
import { revealAppFrame } from '../startup';
/** A short entrance overlaps real initialization; only the exit waits for readiness. */
export function LaunchScreen({ ready, onFinished }: { ready: boolean; onFinished: () => void }) {
  const entrance = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [entered, setEntered] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => { if (mounted) setReduceMotion(true); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; listener.remove(); };
  }, []);
  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) { entrance.setValue(1); setEntered(true); return; }
    const intro = Animated.timing(entrance, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    const breathing = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(pulse, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true })]));
    intro.start(({ finished }) => { if (finished) setEntered(true); }); breathing.start();
    return () => { intro.stop(); breathing.stop(); };
  }, [entrance, pulse, reduceMotion]);
  useEffect(() => {
    if (!ready || !entered) return;
    const exit = Animated.timing(opacity, { toValue: 0, duration: reduceMotion ? 0 : 220, easing: Easing.out(Easing.quad), useNativeDriver: true });
    exit.start(({ finished }) => { if (finished) onFinished(); });
    return () => exit.stop();
  }, [ready, entered, reduceMotion, opacity, onFinished]);
  return <AnimatedView accessibilityLabel="正在启动" accessibilityLiveRegion="polite" style={[styles.screen, { opacity }]} testID="launch-screen">
    <AnimatedView style={{ width: 72, height: 72, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }}>
      <Image source={require('../../assets/app-icon.png')} accessibilityLabel="SolveFlow 应用图标" style={styles.icon} onLoadEnd={() => revealAppFrame(reduceMotion !== false)} />
    </AnimatedView>
    <AnimatedView style={[styles.wordmark, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }]}>
      <Text style={styles.name}>SolveFlow</Text>
    </AnimatedView>
    {!ready && <View style={styles.loading} accessibilityLabel="正在读取本地题目"><AnimatedView style={[styles.progress, { opacity: reduceMotion ? 1 : pulse.interpolate({ inputRange: [0, 1], outputRange: [.4, 1] }), transform: [{ scaleX: reduceMotion ? 1 : pulse.interpolate({ inputRange: [0, 1], outputRange: [.35, 1] }) }] }]} /></View>}
  </AnimatedView>;
}
const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 100, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  icon: { width: 72, height: 72, borderRadius: 18 },
  wordmark: { position: 'absolute', top: '50%', marginTop: 52, alignItems: 'center' },
  name: { color: colors.ink, fontSize: 18, fontWeight: '600', letterSpacing: .4 },
  loading: { position: 'absolute', top: '50%', marginTop: 96, width: 44, height: 2, backgroundColor: '#eef2f8', overflow: 'hidden', borderRadius: 1 },
  progress: { width: 44, height: 2, backgroundColor: colors.blue, borderRadius: 1 },
});
