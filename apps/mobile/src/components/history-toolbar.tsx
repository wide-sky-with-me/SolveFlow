import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { AnimatedView, Pressable, Text, TextInput, View } from '../theme/primitives';
import { colors } from './ui';
import { useReducedMotion } from './use-reduced-motion';
export type HistoryKind = 'single' | 'batch';
export function HistoryToolbar({ kind, onKind, query, onQuery }: { kind: HistoryKind; onKind: (kind: HistoryKind) => void; query: string; onQuery: (value: string) => void }) {
  const [search, setSearch] = useState(false); const [width, setWidth] = useState(0); const [focused, setFocused] = useState(false);
  const position = useRef(new Animated.Value(kind === 'single' ? 0 : 1)).current;
  const reveal = useRef(new Animated.Value(0)).current; const reduced = useReducedMotion();
  const input = useRef<TextInput>(null); const searchButton = useRef<View>(null);
  useEffect(() => {
    const animation = Animated.timing(position, { toValue: kind === 'single' ? 0 : 1, duration: reduced ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [kind, reduced, position]);
  useEffect(() => {
    const animation = Animated.timing(reveal, { toValue: search ? 1 : 0, duration: reduced ? 0 : 180, useNativeDriver: false });
    animation.start(({ finished }) => { if (finished && search) input.current?.focus(); }); return () => animation.stop();
  }, [search, reduced, reveal]);
  function close() { onQuery(''); setSearch(false); searchButton.current?.focus(); }
  return <View style={styles.container}>
    <View style={styles.row} testID="history-toolbar">
      <View style={styles.tabs} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        {(['single', 'batch'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'single' ? '单题记录' : '批量记录'} accessibilityState={{ selected: kind === value }} aria-selected={kind === value} onPress={() => onKind(value)} style={({ pressed }) => [styles.tab, pressed && { opacity: .65 }]}><Text style={[styles.label, kind === value && styles.selected]}>{value === 'single' ? '单题记录' : '批量记录'}</Text></Pressable>)}
        <AnimatedView pointerEvents="none" testID="history-tab-indicator" style={[styles.indicator, { width: Math.max(0, width / 2 - 32), transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [16, width / 2 + 16] }) }] }]} />
      </View>
      <Pressable ref={searchButton} accessibilityRole="button" accessibilityLabel={search ? '收起搜索' : '搜索历史题目'} accessibilityState={{ expanded: search }} onPress={() => search ? close() : setSearch(true)} style={({ pressed }) => [styles.searchButton, pressed && { backgroundColor: '#edf3ff' }]}>
        <View accessible={false} style={{ width: 22, height: 22 }}><View style={styles.lens} /><View style={styles.handle} /></View>
      </Pressable>
    </View>
    <AnimatedView style={{ height: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, 58] }), opacity: reveal, overflow: 'hidden' }}>
      {search && <View style={[styles.searchField, focused && { borderColor: colors.blue }]}>
        <TextInput ref={input} accessibilityLabel="搜索关键词" placeholder="题号、关键词或批次名称" value={query} onChangeText={onQuery} returnKeyType="search" autoCorrect={false} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyPress={event => { if (event.nativeEvent.key === 'Escape') close(); }} style={styles.input} />
        <Pressable accessibilityRole="button" accessibilityLabel={query ? '清除搜索' : '关闭搜索'} onPress={() => { if (query) { onQuery(''); input.current?.focus(); } else close(); }} style={styles.searchButton}><Text style={{ fontSize: 24, color: colors.muted }}>×</Text></Pressable>
      </View>}
    </AnimatedView>
  </View>;
}
const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#fff' }, row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.line },
  tabs: { flex: 1, flexDirection: 'row', position: 'relative' }, tab: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, color: colors.muted }, selected: { color: colors.ink, fontWeight: '600' },
  indicator: { position: 'absolute', bottom: 0, height: 2, borderRadius: 1, backgroundColor: colors.blue },
  searchButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  lens: { position: 'absolute', width: 15, height: 15, top: 1, left: 1, borderWidth: 1.8, borderRadius: 8, borderColor: colors.muted },
  handle: { position: 'absolute', width: 9, height: 1.8, top: 17, left: 13, backgroundColor: colors.muted, transform: [{ rotate: '45deg' }] },
  searchField: { flexDirection: 'row', alignItems: 'center', height: 42, marginTop: 8, borderRadius: 10, backgroundColor: '#f5f7fb', borderWidth: 1, borderColor: colors.line },
  input: { flex: 1, minWidth: 0, height: 42, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, color: colors.ink, outlineStyle: 'solid', outlineWidth: 0 },
});
