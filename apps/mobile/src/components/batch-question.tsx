import { QuestionMaterials } from './question-materials';
import { useImageShare } from './use-image-share';
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import type { LocalDiagnostic, LocalRecord, LocalImageEdit } from '@solveflow/contracts/local';
import { isAuxiliaryContext, terminal, type RunContext, type RunView } from '@solveflow/contracts/http';
import { problemText } from '@solveflow/contracts/agent';
import { clientError } from '@solveflow/client/presentation';
import { questionConversations } from '@solveflow/client/learning';
import type { Runtime } from '../runtime';
import { mergeRunSnapshot, mergeRunUpdate } from '../run-updates';
import { Image, Pressable, Text, View } from '../theme/primitives';
import { QuestionReader } from './question-reader';
import { ImageViewer } from './image-viewer';
import { DiagnosticDetails } from './diagnostic-details';
import { CorrectionModal } from '../workspace/dialogs';
import { Button, Notice, layout, s } from './ui';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';
import { PageMemory } from './page-memory';
import { useQuestionPageReady } from './question-page-ready';

/** Reuses the exact single-photo thread, follow-up, correction and multi-question renderer. */
export const BatchQuestion = memo(function BatchQuestion({ id, runtime, queueBusy, available }: { id: string; runtime: Runtime; queueBusy: boolean; available: boolean }) {
  const { scheme } = useTheme();
  const bg = themeColors[scheme].background;
  const window = useWindowDimensions();
  const [record, setRecord] = useState<LocalRecord | null>(null); const [error, setError] = useState('');
  const memory = useContext(PageMemory);
  const [busy, setBusy] = useState(false); const [selected, select] = useState(() => memory?.selections.get(id) ?? '');
  const [retryQueued, setRetryQueued] = useState(runtime.batch.ids.includes(id));
  const retrying = useRef(false); const submitting = useRef(false);
  useEffect(() => runtime.batch.subscribe(() => setRetryQueued(runtime.batch.ids.includes(id))), [runtime, id]);
  const setSelected = (key: string) => { memory?.selections.set(id, key); select(key); }; const [view, setView] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LocalDiagnostic[] | null>(null);
  const [correction, setCorrection] = useState<{ run: RunView; number?: number; text: string } | null>(null);
  const alive = useRef(true);
  const updates = useRef(new Map<string, RunView>());
  const refresh = useCallback(async () => {
    try {
      const value = await runtime.repository.read(id);
      value.session.runs = mergeRunSnapshot(value.session.runs, [...runtime.engine.actives.filter(run => run.sessionId === id), ...updates.current.values()]);
      if (alive.current) { setRecord(value); setError(''); }
    } catch (cause) { if (alive.current) setError(clientError(cause)); }
  }, [id, runtime]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const off = runtime.engine.subscribe(run => {
      if (run.sessionId === id) {
        updates.current.set(run.id, run);
        setRecord(current => {
          if (!current) return current;
          const updated = { ...current, session: { ...current.session, runs: mergeRunUpdate(current.session.runs, run) } };
          return updated;
        });
      }
    });
    return () => { alive.current = false; off(); };
  }, [id, runtime, refresh]);
  // Decision: .agents/notes/implemented/architecture/2026-10-27-batch-regeneration-admission.md
  async function submit(text: string, context?: RunContext, imageEdit?: LocalImageEdit) {
    if (submitting.current || busy) return false;
    const regenerate = context?.kind === 'regenerate';
    if (regenerate && runtime.batch.ids.includes(id)) return false;
    if (queueBusy && !regenerate && !isAuxiliaryContext(context?.kind)) { setError('请先等待批量任务完成或停止批量解题，再提交追问或更正。'); return false; }
    submitting.current = true; setBusy(true); setError('');
    try {
      if (regenerate) await runtime.regenerateBatch(id, text, context);
      else await runtime.start(id, text, context, imageEdit);
      await refresh(); setCorrection(null); return true;
    } catch (cause) { if (alive.current) setError(clientError(cause)); return false; }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  }
  async function retry(run: RunView) {
    if (retrying.current || busy || runtime.batch.ids.includes(id)) return false;
    retrying.current = true; setBusy(true); setError('');
    try { await runtime.retryBatch(id, run.id); await refresh(); return true; }
    catch (cause) { if (alive.current) setError(clientError(cause)); return false; }
    finally { retrying.current = false; if (alive.current) setBusy(false); }
  }
  const { share, error: shareError } = useImageShare(record?.image ?? null);
  const threads = useMemo(() => questionConversations(record?.session.runs ?? []), [record?.session.runs]); const key = threads.some(row => row.key === selected) ? selected : threads[0]?.key ?? '';
  const activeId = runtime.engine.actives.find(run => run.sessionId === id && !terminal(run.status))?.id ?? null;
  useQuestionPageReady(!record ? !!error : threads.length ? null : true);
  if (!record) return error ? <View testID="batch-read-error" style={[s.pageContent, { gap: 12 }]}>
    <View style={s.card}>
      <Text accessibilityRole="header" style={s.label}>暂时无法读取这道题</Text>
      <Notice text={error} error />
      <Text style={s.subtitle}>你可以切换其他题目；原记录不会被删除或覆盖。</Text>
      <View style={s.row}><Button title="重新读取题目" compact secondary onPress={() => void refresh()} /></View>
    </View>
  </View> : (
    <View style={{ flex: 1, minHeight: 380, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10, backgroundColor: bg }}>
      <Text style={s.subtitle}>正在读取题目…</Text>
    </View>
  );
  return <>
    <QuestionMaterials key={id} id={id} runtime={runtime} disabled={busy || !!activeId} />
    {!!threads.length && retryQueued && !activeId && <View testID="batch-queued-notice" style={styles.body}><View style={styles.status}><Text accessibilityLiveRegion="polite" style={styles.statusText}>等待重新解答</Text></View></View>}
    {(error || shareError) ? <View style={styles.body}><Notice text={error || shareError} error /></View> : null}
    {!threads.length ? <View testID="batch-pending-question" style={styles.body}><View testID="batch-pending-card" style={[s.card, { gap: 16 }]}>
      <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.label}>题目</Text><View style={styles.status}><Text testID="batch-pending-status" accessibilityLiveRegion="polite" style={styles.statusText}>{retryQueued ? '等待解题' : '待解题'}</Text></View></View>
      <Pressable accessibilityRole="button" accessibilityLabel="查看题目图片" onPress={() => setView(true)} onLongPress={() => void share()} style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: '#f5f7fb' }}><Image accessibilityLabel="批量待解题原图" source={{ uri: record.image }} resizeMode="contain" style={{ height: Math.max(160, Math.min(360, (window.width - 84) * record.session.upload.height / record.session.upload.width)), width: '100%' }} /></Pressable>
    </View></View> :
      <QuestionReader runtime={runtime} backupAvailable={!!runtime.settings?.backup} threads={threads} selected={key} onSelect={setSelected} image={record.image} imageSize={record.session.upload} busy={busy} conversationBlocked={queueBusy} regenerateBlocked={retryQueued} activeId={activeId} available={available} connection="" onSubmit={submit} onRetry={retry} retryQueued={retryQueued} onCorrect={(run, number) => { if (run.outcome?.status === 'completed' || run.outcome?.status === 'needs_clarification') setCorrection({ run, text: problemText(run.outcome.candidate.problem).slice(0, 2000), ...(number === undefined ? {} : { number }) }); }} onCancel={runId => { void runtime.engine.cancelRun(runId).catch(cause => setError(clientError(cause))); }} onRefresh={() => void refresh()} onViewOriginal={async () => setView(true)} onAnswerReady={() => {}} onDiagnostics={runId => { void runtime.repository.diagnostics(runId).then(setDiagnostics).catch(cause => setError(clientError(cause))); }} />}
    {view && <ImageViewer uri={record.image} size={record.session.upload} onClose={() => setView(false)} />}
    {diagnostics && <DiagnosticDetails entries={diagnostics} onClose={() => setDiagnostics(null)} />}
    <CorrectionModal correction={correction} runtime={runtime} busy={busy || queueBusy} active={runtime.engine.actives.find(run => run.id === activeId) ?? null} available={available} error={error} onClose={() => setCorrection(null)} onChange={text => setCorrection(value => value ? { ...value, text } : null)} onSubmit={imageEdit => { if (correction) void submit('请按更正后的条件和图片重新解答。', { kind: 'correction', sourceRunId: correction.run.id, text: correction.text, ...(correction.number === undefined ? {} : { number: correction.number }) }, imageEdit); }} />
  </>;
});

const styles = StyleSheet.create({
  body: { width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4 },
  status: { alignSelf: 'flex-start', backgroundColor: '#edf3ff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusText: { color: '#2867dd', fontSize: 13, lineHeight: 20, fontWeight: '500' },
});
