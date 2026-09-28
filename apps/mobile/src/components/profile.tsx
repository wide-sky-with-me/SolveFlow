import { AppearanceSetting } from './appearance-setting';
import { Pressable, Text, View } from '../theme/primitives';
import { StyleSheet } from 'react-native';
import { colors, s } from './ui';
export function Profile({ count, favoriteCount, settingsDisabled, onSettings, onHelp, onHistory, onFavorites, onExport }: { count: number; favoriteCount: number; settingsDisabled: boolean; onSettings: () => void; onHelp: () => void; onHistory: () => void; onFavorites: () => void; onExport: () => void }) {
  return <View style={{ gap: 24 }}>
    <View style={styles.summary}><Pressable accessibilityRole="button" accessibilityLabel="查看历史题目" onPress={onHistory} style={({ pressed }) => [styles.countRow, pressed && { opacity: .65 }]}><Text style={styles.count}>{count}<Text style={s.subtitle}> 道题</Text></Text><Text style={s.link}>查看全部 ›</Text></Pressable></View>
    <View style={styles.menu}>
      <Pressable accessibilityRole="button" accessibilityLabel="收藏的题目" onPress={onFavorites} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f1f5fc' }]}><Text style={[s.label, { flex: 1 }]}>收藏的题目</Text><Text style={s.subtitle}>{favoriteCount}</Text><Text style={styles.chevron}>›</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="设置" accessibilityState={{ disabled: settingsDisabled }} disabled={settingsDisabled} onPress={onSettings} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f1f5fc' }, settingsDisabled && { opacity: .45 }]}><Text style={[s.label, { flex: 1 }]}>模型设置</Text><Text style={styles.chevron}>›</Text></Pressable>
      <AppearanceSetting />
      <Pressable accessibilityRole="button" accessibilityLabel="导出本地记录" disabled={settingsDisabled} accessibilityState={{ disabled: settingsDisabled }} onPress={onExport} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f1f5fc' }, settingsDisabled && { opacity: .45 }]}><Text style={[s.label, { flex: 1 }]}>导出本地记录</Text><Text style={styles.chevron}>›</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="使用说明" onPress={onHelp} style={({ pressed }) => [styles.row, { borderTopWidth: 1, borderTopColor: colors.line }, pressed && { backgroundColor: '#f1f5fc' }]}><Text style={[s.label, { flex: 1 }]}>使用说明</Text><Text style={styles.chevron}>›</Text></Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({ summary: { borderRadius: 18, backgroundColor: '#edf3ff', padding: 22, gap: 8 }, countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 56 }, count: { fontSize: 32, fontWeight: '700', color: colors.blue }, menu: { backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 18 }, row: { minHeight: 68, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, chevron: { fontSize: 25, color: colors.muted } });
