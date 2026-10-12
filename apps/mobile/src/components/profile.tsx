import { AppearanceSetting } from './appearance-setting';
import { Pressable, Text, View } from '../theme/primitives';
import { StyleSheet } from 'react-native';
import { colors, MenuLabel, MenuAccessory, s } from './ui';
import { useMemo } from 'react';
import type { LocalHistorySummary } from '@solveflow/contracts/local';
import { subjectLabel, type QuestionAnswerState } from '@solveflow/contracts/http';
import { useTheme } from '../theme/provider';

const answerStates: ReadonlyArray<{ value: QuestionAnswerState; label: string; light: string; dark: string }> = [
  { value: 'verified', label: '已校验', light: '#29845b', dark: '#7bd8ab' },
  { value: 'answered', label: '待确认', light: '#95630d', dark: '#e8c37e' },
  { value: 'failed', label: '未完成', light: '#b33939', dark: '#ffb2a8' },
  { value: 'unanswered', label: '未作答', light: '#607087', dark: '#a6b5ca' },
];

export function Profile({ sessions, settingsDisabled, onSettings, onHelp, onHistory, onFavorites, onExport, onImport }: { sessions: readonly LocalHistorySummary[]; settingsDisabled: boolean; onSettings: () => void; onHelp: () => void; onHistory: () => void; onFavorites: () => void; onExport: () => void; onImport: () => void }) {
  const { scheme } = useTheme();
  const stats = useMemo(() => {
    const states = { verified: 0, answered: 0, failed: 0, unanswered: 0 };
    const subjects = new Map<string, number>(); const batches = new Set<string>();
    let favorites = 0; let pending = 0; let singles = 0; let unknown = 0;
    for (const row of sessions) {
      if (row.answerState) states[row.answerState]++; else unknown++;
      if (row.favorite) favorites++;
      if (row.pending) pending++;
      if (row.batch) batches.add(row.batch.id); else singles++;
      subjects.set(row.subject, (subjects.get(row.subject) ?? 0) + 1);
    }
    return { states, favorites, pending, singles, unknown, batches: batches.size, subjects: [...subjects].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
  }, [sessions]);
  return <View testID="profile-overview" style={{ gap: 24 }}>
    <View testID="profile-stats" style={styles.stats}>
      <View testID="profile-stat-total" style={[styles.stat, styles.primaryStat]}>
        <Pressable accessibilityRole="button" accessibilityLabel="查看历史题目" onPress={onHistory} style={({ pressed }) => [styles.statButton, pressed && { opacity: .65 }]}>
          <View style={styles.statHeading}><Text style={s.label}>本地记录</Text><Text style={s.link}>›</Text></View>
          <Text style={styles.count}>{sessions.length}<Text style={styles.unit}> 条</Text></Text>
          <Text style={s.subtitle}>单题 {stats.singles} · 批量 {sessions.length - stats.singles}</Text>
        </Pressable>
      </View>
      <View testID="profile-stat-answers" style={styles.stat}><Text style={s.label}>已有解答</Text><Text style={styles.count}>{stats.states.verified + stats.states.answered}<Text style={styles.unit}> 条</Text></Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}><Text style={s.subtitle}>已校验 {stats.states.verified}</Text><Text style={s.subtitle}>待确认 {stats.states.answered}</Text></View></View>
      <View testID="profile-stat-favorites" style={styles.stat}><Text style={s.label}>收藏</Text><Text style={styles.count}>{stats.favorites}<Text style={styles.unit}> 条</Text></Text></View>
      <View testID="profile-stat-batches" style={styles.stat}><Text style={s.label}>批次</Text><Text style={styles.count}>{stats.batches}<Text style={styles.unit}> 个</Text></Text></View>
    </View>
    <View testID="profile-panels" style={{ gap: 20 }}>
      <View testID="profile-records" style={{ gap: 20 }}>
        <View testID="profile-answer-states" style={styles.panel}>
          <View style={styles.panelHeading}><Text accessibilityRole="header" style={s.label}>答题状态</Text><Text testID="profile-pending" style={s.subtitle}>运行中 {stats.pending}</Text></View>
          {answerStates.map(state => <View key={state.value} testID={`profile-state-${state.value}`} style={{ gap: 9 }}>
            <View style={styles.panelHeading}><View style={styles.stateLabel}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: state[scheme] }} /><Text style={styles.body}>{state.label}</Text></View><Text style={styles.stateCount}>{stats.states[state.value]}</Text></View>
            <View style={styles.track}><View style={{ width: `${sessions.length ? stats.states[state.value] / sessions.length * 100 : 0}%`, height: 5, borderRadius: 3, backgroundColor: state[scheme] }} /></View>
          </View>)}
          {stats.unknown > 0 && <Text style={s.subtitle}>状态待恢复 {stats.unknown}</Text>}
        </View>
        <View testID="profile-subjects" style={styles.panel}>
          <Text accessibilityRole="header" style={s.label}>科目分布</Text>
          {stats.subjects.length ? <View style={styles.subjects}>{stats.subjects.map(([subject, count]) => <View key={subject} testID={`profile-subject-${subject}`} style={styles.subject}><Text style={styles.body}>{subjectLabel(subject)}</Text><Text style={styles.stateCount}>{count}</Text></View>)}</View> : <Text style={s.subtitle}>暂无记录</Text>}
        </View>
      </View>
      <View testID="profile-menu" style={styles.menu}>
        <Pressable accessibilityRole="button" accessibilityLabel="收藏的题目" onPress={onFavorites} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f1f5fc' }]}><MenuLabel>收藏的题目</MenuLabel><MenuAccessory value={stats.favorites} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="设置" accessibilityState={{ disabled: settingsDisabled }} disabled={settingsDisabled} onPress={onSettings} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f1f5fc' }, settingsDisabled && { opacity: .45 }]}><MenuLabel>模型设置</MenuLabel><MenuAccessory /></Pressable>
        <AppearanceSetting />
        <Pressable accessibilityRole="button" accessibilityLabel="导出本地记录" disabled={settingsDisabled} accessibilityState={{ disabled: settingsDisabled }} onPress={onExport} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f1f5fc' }, settingsDisabled && { opacity: .45 }]}><MenuLabel>导出本地记录</MenuLabel><MenuAccessory /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="恢复本地记录" disabled={settingsDisabled} accessibilityState={{ disabled: settingsDisabled }} onPress={onImport} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f1f5fc' }, settingsDisabled && { opacity: .45 }]}><MenuLabel>恢复本地记录</MenuLabel><MenuAccessory /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="使用说明" onPress={onHelp} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f1f5fc' }]}><MenuLabel>使用说明</MenuLabel><MenuAccessory /></Pressable>
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { flexBasis: '46%', flexGrow: 1, minWidth: 0, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, padding: 18, gap: 12, minHeight: 148 },
  primaryStat: { backgroundColor: '#edf3ff' }, statButton: { gap: 12, minHeight: 110 },
  statHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontSize: 34, lineHeight: 42, fontWeight: '700', color: colors.ink }, unit: { fontSize: 14, fontWeight: '400', color: colors.muted },
  panel: { padding: 22, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, gap: 20 },
  panelHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stateLabel: { flexDirection: 'row', alignItems: 'center', gap: 9 }, body: { fontSize: 14, color: colors.ink }, stateCount: { fontSize: 15, fontWeight: '600', color: colors.ink },
  track: { height: 5, backgroundColor: '#eef2f7', borderRadius: 3, overflow: 'hidden' },
  subjects: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, subject: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#f5f7fb' },
  menu: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 10, gap: 4 },
  row: { minHeight: 64, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
