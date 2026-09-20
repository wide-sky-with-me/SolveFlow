import { useEffect, useState } from 'react';
import { historyEntry, type LocalSessionView } from '@solveflow/client';
import { subjectLabel } from '@solveflow/contracts/http';
import { Image, Pressable, Text, View } from '../theme/primitives';
import { Button, Card, s } from './ui';

type Props = { sessions: LocalSessionView[]; currentId: string | null; disabled: boolean; loadThumbnail: (id: string) => Promise<string>; onOpen: (id: string) => Promise<void>; onFavorite: (id: string) => Promise<void>; onRemove: (id: string) => Promise<void> };
/** A native fallback must remain useful when every local WebView is unavailable. */
export function HistoryFallback({ sessions, currentId, disabled, loadThumbnail, onOpen, onFavorite, onRemove }: Props) {
  const [page, setPage] = useState(0);
  const [opened, setOpened] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const lastPage = Math.max(0, Math.ceil(sessions.length / 10) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = sessions.slice(currentPage * 10, currentPage * 10 + 10).map(historyEntry);
  const ids = visible.map(entry => entry.id).join(',');
  useEffect(() => {
    let alive = true; setThumbnails({});
    // Only ten small previews are retained, and large source images are decoded sequentially.
    void (async () => { for (const id of ids.split(',').filter(Boolean)) {
      if (!alive) break;
      try { const image = await loadThumbnail(id); if (alive) setThumbnails(value => ({ ...value, [id]: image })); }
      catch { /* The original may be unavailable; retain the actual question text. */ }
    } })();
    return () => { alive = false; };
  }, [ids, loadThumbnail]);
  return <View testID="history-fallback" style={{ gap: 12 }}>{visible.map(entry => <Card key={entry.id} style={{ padding: 12, gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`打开${subjectLabel(entry.subject)}题目 ${entry.id}`} disabled={disabled} onPress={() => void onOpen(entry.id)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 76 }}>
      {thumbnails[entry.id] && <Image accessibilityLabel="原题缩略图" source={{ uri: thumbnails[entry.id] }} resizeMode="contain" style={{ width: 76, height: 76, borderRadius: 8, backgroundColor: '#f7f9fc' }} />}
      <Text numberOfLines={4} style={{ flex: 1, fontSize: 15, lineHeight: 23 }}>{entry.text}</Text>
    </Pressable>
    <View style={s.row}>{entry.favorite && <Text accessibilityLabel="已收藏" style={{ color: '#d79216' }}>★</Text>}<Text style={[s.subtitle, { flex: 1 }]}>{subjectLabel(entry.subject)} · {new Date(entry.createdAt).toLocaleDateString('zh-CN')}{entry.id === currentId ? ' · 当前题目' : ''}</Text><Pressable accessibilityRole="button" accessibilityLabel="题目操作" accessibilityState={{ expanded: opened === entry.id }} disabled={disabled} onPress={() => setOpened(value => value === entry.id ? null : entry.id)} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={s.subtitle}>•••</Text></Pressable></View>
    {opened === entry.id && <View style={s.row}><Button title={entry.favorite ? '取消收藏' : '收藏'} compact secondary disabled={disabled} onPress={() => { setOpened(null); void onFavorite(entry.id); }} /><Button title="移除" compact danger disabled={disabled} onPress={() => { setOpened(null); void onRemove(entry.id); }} /></View>}
  </Card>)}{lastPage > 0 && <View style={s.row}><Button title="上一页" compact secondary disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} /><Text style={s.subtitle}>{currentPage + 1} / {lastPage + 1}</Text><Button title="下一页" compact secondary disabled={currentPage === lastPage} onPress={() => setPage(currentPage + 1)} /></View>}</View>;
}
