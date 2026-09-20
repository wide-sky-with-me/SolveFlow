import { Pressable, Text, View } from '../theme/primitives';
import { useState, type ReactNode } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
export const colors = { blue: '#2867dd', ink: '#172338', muted: '#6b7a90', line: '#e3eaf3', background: '#f5f7fb' };
export function Button({ title, onPress, disabled = false, secondary = false, danger = false, compact = false, icon, testID, selected }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean; compact?: boolean; icon?: 'refresh'; testID?: string; selected?: boolean }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={title} aria-pressed={selected} accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }} disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} testID={testID} style={({ pressed }) => [s.button, secondary ? s.secondary : s.primary, compact && s.compact, danger && s.danger, focused && { borderColor: '#7ba7f0' }, pressed && !disabled && { backgroundColor: danger ? '#fbe2df' : secondary ? '#deebff' : '#2058c2' }, disabled && { opacity: .4 }]}>{icon && <Text accessible={false} style={{ color: danger ? '#b33939' : secondary ? colors.blue : '#fff', fontSize: 21, lineHeight: 24 }}>↻</Text>}<Text style={[s.buttonText, compact && { fontSize: 13 }, secondary && { color: danger ? '#b33939' : colors.blue }]}>{title}</Text></Pressable>;
}
export function Card({ children, style, label }: { children: ReactNode; style?: ViewStyle; label?: string }) { return <View role={label ? "region" : undefined} accessibilityLabel={label} style={[s.card, style]}>{children}</View>; }
export function Notice({ text, error = false }: { text: string; error?: boolean }) { return <View accessibilityRole={error ? 'alert' : 'text'} accessibilityLiveRegion="polite" style={[s.notice, error && { backgroundColor: '#fff0ee' }]}><Text style={{ color: error ? '#a33229' : colors.muted, lineHeight: 22 }}>{text}</Text></View>; }
export const s = StyleSheet.create({
  button: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 1 },
  primary: { backgroundColor: colors.blue, borderColor: colors.blue }, secondary: { backgroundColor: '#edf3ff', borderColor: '#edf3ff' }, danger: { backgroundColor: '#fff0ee', borderColor: '#fff0ee' },
  compact: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12 },
  buttonText: { flexShrink: 1, textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: '600' }, card: { backgroundColor: '#fff', padding: 18, borderRadius: 14, borderWidth: 1, borderColor: colors.line, gap: 12 },
  notice: { padding: 12, backgroundColor: '#eef3fb', borderRadius: 10 }, title: { fontSize: 21, fontWeight: '700', color: colors.ink }, subtitle: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 }, input: { borderWidth: 1, borderColor: '#d8e2ef', borderRadius: 10, minHeight: 80, padding: 12, fontSize: 16, lineHeight: 24, color: colors.ink, backgroundColor: '#fff', textAlignVertical: 'top' },
  label: { fontSize: 15, fontWeight: '600', color: colors.ink }, link: { color: colors.blue, fontSize: 14 },
});
