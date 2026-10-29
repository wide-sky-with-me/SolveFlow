import { useMemo } from 'react';
import { subjectLabel } from '@solveflow/contracts/http';
import type { LocalHistorySummary } from '@solveflow/contracts/local';
import { formatHistoryTime } from '@solveflow/client/presentation';
import { Pressable, Text, View } from '../theme/primitives';
import { Button, MenuAccessory, colors, s } from './ui';

const answerLabels = { verified: '已校验', answered: '待确认', failed: '未完成', unanswered: '未作答' };
type RecentRecord = { row: LocalHistorySummary; count: number; pending: boolean };

export function RecentRecords({ sessions, disabled, onOpen, onHistory }: {
  sessions: readonly LocalHistorySummary[];
  disabled: boolean;
  onOpen: (id: string) => Promise<void>;
  onHistory: () => void;
}) {
  const recent = useMemo(() => {
    const groups = new Map<string, RecentRecord>();
    for (const row of [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const key = row.batch ? `batch:${row.batch.id}` : row.id;
      const existing = groups.get(key);
      if (existing) { existing.count++; existing.pending ||= row.pending; }
      else groups.set(key, { row, count: 1, pending: row.pending });
    }
    return [...groups.values()].slice(0, 4);
  }, [sessions]);
  if (!recent.length) return null;

  return <View testID="home-recent" style={{ gap: 14 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text accessibilityRole="header" style={[s.label, { fontSize: 19 }]}>最近记录</Text>
      <Button title="查看全部" compact secondary disabled={disabled} onPress={onHistory} />
    </View>
    <View testID="home-recent-grid" style={{ gap: 12 }}>
      {recent.map(({ row, count, pending }) => {
        const title = row.batch?.title ?? (row.text.trim() || '已保存的题目');
        const state = pending ? '解题中' : row.answerState ? answerLabels[row.answerState] : '已保存';
        return <Pressable key={row.batch ? `batch:${row.batch.id}` : row.id} testID="home-recent-record" accessibilityRole="button"
          accessibilityLabel={`打开${row.batch ? '批次' : '题目'}：${title.slice(0, 80)}`} disabled={disabled}
          onPress={() => void onOpen(row.id)}
          style={({ pressed }) => [{ minHeight: 108, padding: 18, gap: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center' }, pressed && { backgroundColor: '#edf3ff' }, disabled && { opacity: .5 }]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{ width: 44, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf3ff', borderRadius: 12, flexShrink: 0 }}>
            {row.batch && <View style={{ position: 'absolute', width: 21, height: 26, left: 9, top: 8, borderRadius: 4, borderWidth: 1.5, borderColor: colors.blue }} />}
            <View style={{ width: 21, height: 26, padding: 4, gap: 4, borderRadius: 4, borderWidth: 1.5, borderColor: colors.blue, backgroundColor: '#edf3ff' }}>
              <View style={{ height: 2, backgroundColor: colors.blue, borderRadius: 1 }} /><View style={{ height: 2, backgroundColor: colors.blue, borderRadius: 1 }} />
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <Text numberOfLines={2} style={[s.label, { lineHeight: 22 }]}>{title}</Text>
            <Text numberOfLines={1} style={[s.subtitle, { fontSize: 12, lineHeight: 20 }]}>
              {row.batch ? `${count} 张题图${pending ? ' · 解题中' : ''}` : `${subjectLabel(row.subject)} · ${state}`} · {formatHistoryTime(row.createdAt).slice(0, 16)}
            </Text>
          </View>
          <MenuAccessory />
        </Pressable>;
      })}
    </View>
  </View>;
}
