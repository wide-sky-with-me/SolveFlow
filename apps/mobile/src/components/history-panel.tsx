import type { LocalHistorySummary } from '@solveflow/contracts/local';
import { AppState, Platform } from 'react-native';
import { startDocumentDeadline } from './document-deadline';
import { themeColors } from '../theme/palette';
import { useTheme } from '../theme/provider';
import { ScrollView, Text, View } from '../theme/primitives';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { encodeHistoryDocument } from '@solveflow/client/presentation';
import { HistoryFallback } from './history-fallback';
import HistoryDocument from '../dom/history-document';
import { documentProps } from '../document-props';
import { Button, Notice, s } from './ui';
export function HistoryPanel({ viewport = false, filterKey = '', footer, sessions, currentId, disabled, loadThumbnail, onPageChange, onOpen, onFavorite, onRemove }: { viewport?: boolean; filterKey?: string; footer?: ReactNode; sessions: LocalHistorySummary[]; currentId: string | null; disabled: boolean; onPageChange: () => void; loadThumbnail: (id: string) => Promise<string>; onOpen: (id: string) => Promise<void>; onFavorite: (id: string) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const { scheme } = useTheme();
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filterKey]);
  const lastPage = Math.max(0, Math.ceil(sessions.length / 20) - 1); const currentPage = Math.min(page, lastPage);
  const payload = useMemo(() => encodeHistoryDocument(sessions.slice(currentPage * 20, currentPage * 20 + 20), currentId, disabled, currentPage * 20), [sessions, currentPage, currentId, disabled]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (state !== 'loading') return; return startDocumentDeadline(() => setState('failed'), { isActive: () => AppState.currentState === 'active', subscribe: listener => { const subscription = AppState.addEventListener('change', listener); return () => subscription.remove(); } }); }, [state, attempt]);
  const ready = useCallback(async () => setState(value => value === 'failed' ? value : 'ready'), []);
  const failed = useCallback(() => setState('failed'), []);
  const dom = useMemo(() => ({ ...documentProps, ...(viewport && Platform.OS !== 'web' ? { matchContents: false, scrollEnabled: true, containerStyle: { flex: 1, width: '100%' as const, minHeight: 0 } } : {}), style: { flex: 1, backgroundColor: themeColors[scheme].background }, onError: failed, onHttpError: failed, onRenderProcessGone: failed, onContentProcessDidTerminate: failed }), [failed, scheme, viewport]);
  const open = useCallback(async (id: string) => { if (!disabled && sessions.some(session => session.id === id)) await onOpen(id); }, [disabled, sessions, onOpen]);
  const favorite = useCallback(async (id: string) => { if (!disabled && sessions.some(session => session.id === id)) await onFavorite(id); }, [disabled, sessions, onFavorite]);
  const remove = useCallback(async (id: string) => { if (!disabled && sessions.some(session => session.id === id)) await onRemove(id); }, [disabled, sessions, onRemove]);
  if (state === 'failed') return <ScrollView contentContainerStyle={{ gap: 12 }}><Notice text="题目摘要加载失败，仍可打开已保存的解答。" error /><Button title="重新加载题目摘要" secondary onPress={() => { setAttempt(value => value + 1); setState('loading'); }} /><HistoryFallback key={filterKey} {...{ sessions, currentId, disabled, loadThumbnail, onPageChange }} onOpen={open} onFavorite={favorite} onRemove={remove} />{footer && <View style={s.row}>{footer}</View>}</ScrollView>;
  return <View style={viewport ? { flex: 1, minHeight: 0 } : undefined}>
    {state === 'loading' && <Text style={s.subtitle}>正在显示题目…</Text>}
    <HistoryDocument viewport={viewport} theme={scheme} key={attempt} dom={dom} historyPayload={payload} onOpen={open} onFavorite={favorite} onRemove={remove} onReady={ready} />
    {(footer || lastPage > 0) && <View testID="history-footer" style={[s.row, { justifyContent: footer ? 'space-between' : 'flex-end', paddingVertical: 8, flexShrink: 0 }]}>
      {footer}
      {lastPage > 0 && <View testID="history-pagination" style={s.row}>
        <Button title="上一页" compact secondary disabled={disabled || currentPage === 0} onPress={() => { setPage(currentPage - 1); onPageChange(); }} />
        <Text style={s.subtitle}>第 {currentPage + 1} / {lastPage + 1} 页</Text>
        <Button title="下一页" compact secondary disabled={disabled || currentPage === lastPage} onPress={() => { setPage(currentPage + 1); onPageChange(); }} />
      </View>}
    </View>}
  </View>;
}
