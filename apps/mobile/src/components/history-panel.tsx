import { AppState } from 'react-native';
import { startDocumentDeadline } from './document-deadline';
import { themeColors } from '../theme/palette';
import { useTheme } from '../theme/provider';
import { Text, View } from '../theme/primitives';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { encodeHistoryDocument, type LocalSessionView } from '@solveflow/client';
import { HistoryFallback } from './history-fallback';
import HistoryDocument from '../dom/history-document';
import { documentProps } from '../document-props';
import { Button, Notice, s } from './ui';
export function HistoryPanel({ sessions, currentId, disabled, loadThumbnail, onOpen, onFavorite, onRemove }: { sessions: LocalSessionView[]; currentId: string | null; disabled: boolean; loadThumbnail: (id: string) => Promise<string>; onOpen: (id: string) => Promise<void>; onFavorite: (id: string) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const { scheme } = useTheme();
  const payload = useMemo(() => encodeHistoryDocument(sessions, currentId, disabled), [sessions, currentId, disabled]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (state !== 'loading') return; return startDocumentDeadline(() => setState('failed'), { isActive: () => AppState.currentState === 'active', subscribe: listener => { const subscription = AppState.addEventListener('change', listener); return () => subscription.remove(); } }); }, [state, attempt]);
  const ready = useCallback(async () => setState(value => value === 'failed' ? value : 'ready'), []);
  const failed = useCallback(() => setState('failed'), []);
  const dom = useMemo(() => ({ ...documentProps, style: { backgroundColor: themeColors[scheme].background }, onError: failed, onHttpError: failed, onRenderProcessGone: failed, onContentProcessDidTerminate: failed }), [failed, scheme]);
  const open = useCallback(async (id: string) => { if (!disabled && sessions.some(session => session.id === id)) await onOpen(id); }, [disabled, sessions, onOpen]);
  const favorite = useCallback(async (id: string) => { if (!disabled && sessions.some(session => session.id === id)) await onFavorite(id); }, [disabled, sessions, onFavorite]);
  const remove = useCallback(async (id: string) => { if (!disabled && sessions.some(session => session.id === id)) await onRemove(id); }, [disabled, sessions, onRemove]);
  if (state === 'failed') return <View style={{ gap: 12 }}><Notice text="题目摘要加载失败，仍可打开已保存的解答。" error /><Button title="重新加载题目摘要" secondary onPress={() => { setAttempt(value => value + 1); setState('loading'); }} /><HistoryFallback {...{ sessions, currentId, disabled, loadThumbnail }} onOpen={open} onFavorite={favorite} onRemove={remove} /></View>;
  return <View>{state === 'loading' && <Text style={s.subtitle}>正在显示题目…</Text>}<HistoryDocument theme={scheme} key={attempt} dom={dom} historyPayload={payload} onOpen={open} onFavorite={favorite} onRemove={remove} onReady={ready} /></View>;
}
