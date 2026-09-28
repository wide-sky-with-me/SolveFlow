import { useState } from 'react';
import type { LocalHistorySummary } from '@solveflow/contracts/local';
import { formatHistoryTime } from '@solveflow/client';
import type { BatchView } from './batch-workspace';
import { Pressable, Text, View } from '../theme/primitives';
import { Button, colors, s } from './ui';
import { BatchName } from './batch-name';
export function BatchHistory({ rows, query, disabled, onOpen, onRemove, onRename }: { rows: LocalHistorySummary[]; query: string; disabled: boolean; onOpen: (batch: BatchView) => void; onRemove: (id: string) => void; onRename: (id: string, title: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState<string | null>(null); const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const groups = new Map<string, LocalHistorySummary[]>(); const search = query.toLocaleLowerCase();
  for (const row of rows) if (row.batch) { const group = groups.get(row.batch.id) ?? []; group.push(row); groups.set(row.batch.id, group); }
  const matches = [...groups.values()].filter(group => group.some(row => `${row.batch?.title} ${row.text}`.toLocaleLowerCase().includes(search)));
  return <View>{matches.map(group => {
    group.sort((a, b) => a.batch!.position - b.batch!.position); const first = group[0]!; const batch = first.batch!;
    const match = search ? group.find(row => row.text.toLocaleLowerCase().includes(search)) : first;
    return <View key={batch.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Pressable accessibilityRole="button" accessibilityLabel="打开批量" disabled={disabled} onPress={() => { const { position: _position, ...identity } = batch; onOpen({ ...identity, ...(match ? { selectedId: match.id } : {}) }); }} style={({ pressed }) => [{ flex: 1, minWidth: 0, paddingHorizontal: 6, paddingVertical: 8, gap: 5 }, pressed && { opacity: .6 }]}>
        <Text numberOfLines={1} style={s.label}>{batch.title}</Text><Text style={[s.subtitle, { fontSize: 12 }]}>{group.length} 张题图 · {formatHistoryTime(batch.createdAt)}{group.some(row => row.pending) ? ' · 解题中' : ''}</Text>
        {search && match && <Text numberOfLines={1} style={[s.subtitle, { fontSize: 12 }]}>第 {match.batch!.position} 张 · {match.text}</Text>}
      </Pressable><Pressable accessibilityRole="button" accessibilityLabel={`批次操作：${batch.title}`} accessibilityState={{ expanded: expanded === batch.id }} disabled={disabled} onPress={() => setExpanded(expanded === batch.id ? null : batch.id)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24, color: colors.muted }}>⋯</Text></Pressable></View>
      {expanded === batch.id && <View style={s.row}><Button title="重命名" compact secondary disabled={disabled} onPress={() => setRename(batch)} /><Button title="删除本批" compact danger secondary disabled={disabled} onPress={() => onRemove(batch.id)} /></View>}
    </View>;
  })}{!matches.length && <Text style={[s.subtitle, { paddingVertical: 24, textAlign: 'center' }]}>{groups.size ? '没有找到匹配的批次' : '还没有批量解题记录。'}</Text>}
    {rename && <BatchName title={rename.title} onClose={() => setRename(null)} onSave={title => onRename(rename.id, title)} />}
  </View>;
}
