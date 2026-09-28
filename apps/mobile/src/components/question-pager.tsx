import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Keyboard, PanResponder, Platform, StyleSheet } from 'react-native';
import { AnimatedView, Pressable, ScrollView, Text, View } from '../theme/primitives';
import { useReducedMotion } from './use-reduced-motion';
import { questionSwipe } from './question-swipe';
import { QuestionPageActivity } from './question-page-activity';
import { colors } from './ui';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';
function PagerArrow({ previous = false }: { previous?: boolean }) {
  const { scheme } = useTheme();
  return <View accessible={false} style={{ width: 9, height: 9, borderTopWidth: 1.8, borderRightWidth: 1.8, borderColor: themeColors[scheme].accent, transform: [{ rotate: previous ? '-135deg' : '45deg' }], marginLeft: previous ? 4 : -4 }} />;
}

export function QuestionPager<T extends { key: string; number?: number }>({ threads, selected, onSelect, render, retainPages = true, scrollPages = true }: {
  retainPages?: boolean; scrollPages?: boolean; threads: T[]; selected: string; onSelect: (key: string) => void;
  render: (thread: T, onSwipe: (direction: number) => Promise<void>) => ReactNode;
}) {
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set([selected]));
  const progress = useRef(new Animated.Value(1)).current; const reduced = useReducedMotion();
  const numbered = threads.filter(thread => thread.number !== undefined);
  const pages = numbered.length ? numbered : threads;
  const axisThreads = numbered.length ? [...numbered, ...threads.filter(thread => thread.number === undefined)] : threads;
  const index = pages.findIndex(thread => thread.key === selected);
  const axis = useRef<ScrollView>(null); const axisWidth = useRef(0); const positions = useRef(new Map<string, { x: number; width: number }>());
  function centerSelected() { const position = positions.current.get(selected); if (position && axisWidth.current) axis.current?.scrollTo({ x: Math.max(0, position.x - (axisWidth.current - position.width) / 2), animated: !reduced }); }
  useEffect(centerSelected, [selected, reduced]);
  const lastMove = useRef(0); const direction = useRef(1); const started = useRef(0);
  useEffect(() => { setVisited(current => current.has(selected) ? current : new Set([...current, selected])); }, [selected]);
  useEffect(() => {
    progress.stopAnimation(); progress.setValue(reduced ? 1 : 0);
    if (reduced) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: 200, useNativeDriver: true }); animation.start();
    return () => animation.stop();
  }, [selected, reduced, progress]);
  function choose(next: number) {
    const thread = pages[next]; if (!thread || next === index) return;
    direction.current = next > index ? -1 : 1; Keyboard.dismiss(); onSelect(thread.key);
  }
  async function swipe(delta: number) {
    if (index < 0 || (delta !== -1 && delta !== 1) || Date.now() - lastMove.current < 300) return;
    lastMove.current = Date.now(); choose(index + delta);
  }
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => { started.current = Date.now(); return false; },
    onMoveShouldSetPanResponder: (_event, gesture) => Platform.OS !== 'web' && threads.length > 1 && Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.8,
    onPanResponderRelease: (_event, gesture) => { const delta = questionSwipe(gesture.dx, gesture.dy, Date.now() - started.current); if (delta) void swipe(delta); },
  }), [index, threads, selected]);
  return <View style={styles.root}>
    {threads.length > 1 && <View style={styles.navigation} {...responder.panHandlers}>
      <Pressable accessibilityRole="button" accessibilityLabel="上一道题" disabled={index <= 0} accessibilityState={{ disabled: index <= 0 }} onPress={() => choose(index - 1)} style={[styles.arrow, index <= 0 && styles.disabled]}><PagerArrow previous /></Pressable>
      <ScrollView ref={axis} horizontal showsHorizontalScrollIndicator={false} style={styles.track} onLayout={event => { axisWidth.current = event.nativeEvent.layout.width; centerSelected(); }} contentContainerStyle={styles.axis} accessibilityLabel="题号导航">
        {axisThreads.map((thread, number) => <Pressable key={thread.key} hitSlop={{ top: 4, bottom: 4 }} onLayout={event => { positions.current.set(thread.key, event.nativeEvent.layout); if (thread.key === selected) centerSelected(); }} accessibilityRole="tab" accessibilityLabel={thread.number === undefined ? threads.some(item => item.number !== undefined) ? '补充记录' : `题目 ${number + 1}` : `跳转第${thread.number}题`} accessibilityState={{ selected: selected === thread.key }} aria-selected={selected === thread.key} onPress={() => { Keyboard.dismiss(); direction.current = pages.findIndex(item => item.key === thread.key) > index ? -1 : 1; onSelect(thread.key); }} style={[styles.tab, thread.number === undefined && !!numbered.length && styles.supplement, selected === thread.key && styles.selected]}><Text style={[styles.tabText, selected === thread.key && styles.selectedText]}>{thread.number === undefined ? threads.some(item => item.number !== undefined) ? '补充' : `${number + 1}` : `${thread.number}`}</Text></Pressable>)}
      </ScrollView>
      <Text accessibilityLiveRegion="polite" style={styles.count}>{index < 0 ? '记录' : `${index + 1}/${pages.length}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="下一道题" disabled={index < 0 || index >= pages.length - 1} accessibilityState={{ disabled: index < 0 || index >= pages.length - 1 }} onPress={() => choose(index + 1)} style={[styles.arrow, (index < 0 || index >= pages.length - 1) && styles.disabled]}><PagerArrow /></Pressable>
    </View>}
    {threads.map(thread => (retainPages && visited.has(thread.key) || selected === thread.key) && <AnimatedView key={thread.key} testID={`question-page-${thread.number ?? 'record'}`} accessibilityElementsHidden={thread.key !== selected} importantForAccessibility={thread.key === selected ? 'auto' : 'no-hide-descendants'} style={{ flex: 1, display: thread.key === selected ? 'flex' : 'none', opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [direction.current * 26, 0] }) }] }}>
      <QuestionPageActivity value={thread.key === selected}>{scrollPages ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{render(thread, thread.key === selected ? swipe : async () => {})}<Text style={styles.disclaimer}>AI 解答仅供参考，请结合题目核对。</Text></ScrollView> : render(thread, thread.key === selected ? swipe : async () => {})}</QuestionPageActivity>
    </AnimatedView>)}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 8, width: '100%', maxWidth: 920, alignSelf: 'center', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.line },
  track: { flex: 1, height: 44, backgroundColor: '#f5f7fb', borderRadius: 14 },
  axis: { gap: 4, height: 44, alignItems: 'center', paddingHorizontal: 4 },
  tab: { minWidth: 44, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  supplement: { marginLeft: 4, borderLeftWidth: 1, borderLeftColor: colors.line, borderRadius: 0 },
  selected: { backgroundColor: '#edf3ff', borderRadius: 10, borderLeftWidth: 0 },
  tabText: { fontSize: 15, lineHeight: 22, includeFontPadding: false, color: colors.muted, fontVariant: ['tabular-nums'] },
  selectedText: { color: colors.blue, fontWeight: '700' },
  arrow: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: .3 }, count: { width: 32, fontSize: 12, lineHeight: 18, includeFontPadding: false, textAlign: 'center', color: colors.muted, fontVariant: ['tabular-nums'] },
  content: { padding: 10, paddingBottom: 20, gap: 10, width: '100%', maxWidth: 920, alignSelf: 'center' },
  disclaimer: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 6 },
});
