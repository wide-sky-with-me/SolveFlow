import { EXAM_LABELS, type ExamType, type LocalHistorySummary } from '@solveflow/contracts/local';
import { problemText } from "@solveflow/contracts/agent";
import { ThemeProvider } from './theme/provider';
import { Image, Pressable, ScrollView, Text, TextInput, View, SafeAreaView } from './theme/primitives';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Modal, Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { z } from 'zod';
import { isAuxiliaryContext, terminal, type RunContext, type RunView, type SessionView } from '@solveflow/contracts/http';
import type { LocalDiagnostic } from '@solveflow/contracts/local';
import { DiagnosticDetails } from './components/diagnostic-details';
import { clientError, questionConversations } from '@solveflow/client';
import { createRuntime, type Runtime } from './runtime';
import { initialSession, rememberSession, photoData, pickPhoto, recoverPhoto, releasePhoto, transformPhoto } from './platform';
import type { Photo } from './platform.types';
import { CaptureFlow } from './components/batch-capture';
import { HistoryToolbar } from './components/history-toolbar';
import { ImageViewer } from './components/image-viewer';
import { FormulaEditor } from './components/formula-editor';
import { PhotoEditor } from './components/photo-editor';
import { BatchWorkspace, type BatchView } from './components/batch-workspace';
import { BatchHistory } from './components/batch-history';
import { HistoryPanel } from './components/history-panel';
import { HistoryExport } from './components/history-export';
import { QuestionReader } from './components/question-reader';
import { useWorkspaceNavigation } from './use-workspace-navigation';
import { mergeRunUpdate } from './run-updates';
import { Settings } from './components/settings';
import { AppNavigation, type AppTab } from './components/app-navigation';
import { Profile } from './components/profile';
import { EmptyState } from './components/empty-state';
import { LaunchScreen } from './components/launch-screen';
import { Button, Card, Notice, colors, s } from './components/ui';

type Correction = { run: RunView; number?: number; text: string };
export default function App() { return <ThemeProvider><Application /></ThemeProvider>; }
function Application() {
  const [runtime, setRuntime] = useState<Runtime | null>(null); const [error, setError] = useState('');
  const [openingAttempt, setOpeningAttempt] = useState(0);
  const [launched, setLaunched] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const finishLaunch = useCallback(() => setLaunched(true), []);
  const finishRestoring = useCallback(() => setWorkspaceReady(true), []);
  useEffect(() => { let alive = true; void createRuntime().then(value => { if (alive) setRuntime(value); }).catch(cause => { if (alive) setError(clientError(cause)); }); return () => { alive = false; }; }, [openingAttempt]);
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>{runtime ? <Workspace runtime={runtime} onReady={finishRestoring} /> : error ? <SafeAreaView style={styles.shell}><Card><Text style={s.title}>暂时无法打开题目</Text><Notice text={error} error /><Button title="重新打开" onPress={() => { setError(''); setOpeningAttempt(value => value + 1); }} /></Card></SafeAreaView> : <View style={styles.shell} />}{!launched && <LaunchScreen ready={workspaceReady || !!error} onFinished={finishLaunch} />}</SafeAreaProvider>;
}
function Workspace({ runtime, onReady }: { runtime: Runtime; onReady: () => void }) {
  const [selectedQuestion, setSelectedQuestion] = useState<{ sessionId: string; key: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const [readyPanels, setReadyPanels] = useState<ReadonlySet<string>>(new Set());
  const startupReported = useRef(false);
  const answerReady = useCallback((key: string) => { if (startupReported.current) return; setReadyPanels(current => current.has(key) ? current : new Set([...current, key])); }, []);
  const [available, setAvailable] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false);
  const navigation = useWorkspaceNavigation(); const navigate = navigation.navigate;
  const appTab: AppTab = ['profile', 'favorites'].includes(navigation.route.page) ? 'profile' : 'questions';
  const tab = navigation.route.page === 'history' ? 'history' : 'solve';
  const profileSection = navigation.route.page === 'favorites' ? 'favorites' : 'main';
  const setTab = (value: 'solve' | 'history') => navigate(value === 'solve' ? navigation.current : { page: 'history' });
  const setAppTab = (value: AppTab) => navigate(value === 'questions' ? navigation.current : { page: 'profile' });
  const setProfileSection = (value: 'main' | 'favorites') => navigate({ page: value === 'favorites' ? 'favorites' : 'profile' });
  const [historyMounted, setHistoryMounted] = useState(false);
  const [sessions, setSessions] = useState<LocalHistorySummary[]>([]);
  const [session, setSession] = useState<SessionView | null>(null); const [photo, setPhoto] = useState<Photo | null>(null); const [image, setImage] = useState<string | null>(null);
  const [sessionExam, setSessionExam] = useState<ExamType>('general');
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [camera, setCamera] = useState(false); const [editing, setEditing] = useState(false);
  const batchView = navigation.current.batch ?? null;
  const setBatchView = (batch: BatchView) => navigate({ page: 'current', batch });
  const [historyKind, setHistoryKind] = useState<'single' | 'batch'>('single');
  const [historySearch, setHistorySearch] = useState('');
  const [batchBusy, setBatchBusy] = useState(runtime.batch.busy);
  const [exportOpen, setExportOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LocalDiagnostic[] | null>(null);
  const [correction, setCorrection] = useState<Correction | null>(null); const [confirmDelete, setConfirmDelete] = useState<string | null>(null); const [help, setHelp] = useState(false);
  useEffect(() => { if (appTab === 'questions' && tab === 'history') setHistoryMounted(true); }, [appTab, tab]);
  const [viewImage, setViewImage] = useState(false); const [activeId, setActiveId] = useState<string | null>(null);
  const locked = useRef(false); const scroll = useRef<ScrollView>(null); const alive = useRef(true); const loading = useRef(0);
  const historyScroll = useRef<ScrollView>(null); const profileScroll = useRef<ScrollView>(null);
  const resetHistoryScroll = useCallback(() => historyScroll.current?.scrollTo({ y: 0, animated: false }), []);
  const resetProfileScroll = useCallback(() => profileScroll.current?.scrollTo({ y: 0, animated: false }), []);
  const active = session?.runs.find(run => !terminal(run.status) && !isAuxiliaryContext(run.context?.kind)) ?? null;
  useEffect(() => () => releasePhoto(photo), [photo]);
  const list = useCallback(async () => { const value = await runtime.repository.listHistory(); if (alive.current) setSessions(value); }, [runtime]);
  const loadThumbnail = useCallback(async (id: string) => {
    const record = await runtime.repository.read(id);
    const photo = await transformPhoto({ uri: record.image, width: record.session.upload.width, height: record.session.upload.height }, undefined, false, 256);
    try { return await photoData(photo); } finally { releasePhoto(photo); }
  }, [runtime]);
  const updateAvailability = useCallback(() => { void runtime.configured().then(value => { if (alive.current) setAvailable(value); }).catch(() => { if (alive.current) setError('无法读取模型配置。'); }); }, [runtime]);
  const openSession = useCallback(async (id: string, mode: 'push' | 'restore' | 'refresh' = 'push') => {
    const ticket = ++loading.current; setBusy(true); setError('');
    try { const record = await runtime.repository.read(id); if (!alive.current || ticket !== loading.current) return;
      if (record.batch) { const { position: _position, ...batch } = record.batch; if (mode !== 'refresh') navigate({ page: 'current', batch: { ...batch, selectedId: id } }, mode === 'restore'); return; }
      for (const running of runtime.engine.actives) if (running.sessionId === id) record.session.runs = record.session.runs.map(run => run.id === running.id ? running : run);
      if (mode !== 'refresh') navigate({ page: 'current', questionId: id }, mode === 'restore'); await rememberSession(id); setSession(record.session); setSessionExam(record.exam ?? 'general'); setImage(record.image); setPhoto(null); setMessage(''); scroll.current?.scrollTo({ y: 0 });
    } catch (cause) { if (alive.current && ticket === loading.current) setError(clientError(cause)); }
    finally { if (alive.current && ticket === loading.current) setBusy(false); }
  }, [runtime, navigate]);
  const updateRun = useCallback((run: RunView) => { if (!alive.current) return; setActiveId(runtime.engine.actives.find(item => !terminal(item.status))?.id ?? null); setSession(current => current?.id === run.sessionId ? { ...current, runs: mergeRunUpdate(current.runs, run) } : current); if (terminal(run.status)) void list().catch(() => setError('本地记录刷新失败。')); }, [list, runtime]);
  useEffect(() => {
    alive.current = true;
    const unsubscribeBatch = runtime.batch.subscribe(() => { if (alive.current) { setBatchBusy(runtime.batch.busy); void list(); } });
    const unsubscribe = runtime.engine.subscribe(updateRun); const unsubscribeError = runtime.engine.onError(setError);
    void (async () => { try { const configured = await runtime.configured(); if (!alive.current) return; setAvailable(configured); await list(); const recovered = await recoverPhoto(); if (!alive.current) { releasePhoto(recovered); return; } if (recovered) { setPhoto(recovered); setEditing(true); return; } const id = await initialSession(); if (id && z.uuid().safeParse(id).success) await openSession(id, 'restore'); } catch (cause) { if (alive.current) setError(clientError(cause)); } finally { if (alive.current) setRestored(true); } })();
    const sub = AppState.addEventListener('change', value => { if (value === 'background' && Platform.OS === 'ios') void runtime.batch.stop().then(() => runtime.engine.cancel()); });
    return () => { alive.current = false; unsubscribe(); unsubscribeBatch(); unsubscribeError(); sub.remove(); if (Platform.OS !== 'android') void runtime.batch.stop().then(() => runtime.engine.cancel()); };
  }, [runtime, list, openSession, updateRun, updateAvailability, onReady]);
  useEffect(() => {
    const route = navigation.route;
    if (!restored || route.page !== 'current') return;
    if (route.questionId && route.questionId !== session?.id) void openSession(route.questionId, 'refresh');
    else if (!route.questionId && !route.batch) {
      loading.current++; setBusy(false); setSession(null); setImage(null);
      void rememberSession(null).catch(cause => setError(clientError(cause)));
    }
  }, [navigation.route, restored, openSession]);

  function reset() { if (locked.current) return; loading.current++; setSession(null); setPhoto(null); setImage(null); setMessage(''); setError(''); setCamera(false); setEditing(false); setViewImage(false); navigate({ page: 'current' }); void rememberSession(null).catch(cause => setError(clientError(cause))); }
  function choose(value: Photo) { if (locked.current) { releasePhoto(value); return; } loading.current++; setPhoto(value); setSession(null); setImage(null); setMessage(''); setError(''); navigate({ page: 'current' }); setCamera(false); setEditing(true); void rememberSession(null).catch(cause => setError(clientError(cause))); }
  async function gallery() { if (busy) return; setCamera(false); try { const value = await pickPhoto(); if (value) { if (alive.current) choose(value); else releasePhoto(value); } } catch { setError('无法读取图片，请选择清晰的题目照片。'); } }
  async function rotate() { if (!photo || busy) return; setBusy(true); try { const value = await transformPhoto(photo, undefined, true); if (alive.current) setPhoto(value); else releasePhoto(value); } catch (cause) { setError(clientError(cause)); } finally { if (alive.current) setBusy(false); } }
  async function submit(text = message, context?: RunContext): Promise<boolean> {
    if (locked.current || busy || runtime.batch.busy) return false; if (!isAuxiliaryContext(context?.kind) && (activeId || active)) return false; locked.current = true; setBusy(true); setError('');
    try {
      let current = session;
      if (!current) { if (!photo) throw new Error('请先拍摄或选择题目照片。'); const normalized = await transformPhoto(photo);
        try { const record = await runtime.engine.create(await photoData(normalized), normalized.width, normalized.height, runtime.settings?.exam ?? 'general'); setSessionExam(record.exam ?? 'general'); current = record.session; setImage(record.image); setSession(current); setPhoto(null); navigate({ page: 'current', questionId: current.id }, true); await rememberSession(current.id); await list(); } finally { releasePhoto(normalized); }
      }
      if (!available) return true;
      await runtime.start(current.id, text, context); setCorrection(null); setMessage(''); return true;
    } catch (cause) { if (alive.current) setError(clientError(cause)); return false; }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function cancel() { setBusy(true); try { await runtime.engine.cancel(); } catch { setError('取消任务失败。'); } finally { setBusy(false); } }
  async function favorite(id: string) {
    const selected = sessions.find(item => item.id === id); if (busy || !selected) return;
    setBusy(true); setError('');
    try { await runtime.repository.setFavorite(id, !selected.favorite); await list(); }
    catch (cause) { setError(clientError(cause)); } finally { setBusy(false); }
  }
  async function requestRemove(id: string) { if (!busy && sessions.some(item => item.id === id)) setConfirmDelete(id); }
  async function remove() {
    const id = confirmDelete; if (!id || busy) return; setBusy(true); setError('');
    try { if (id === 'all') { await runtime.batch.stop(); await runtime.engine.removeAll(); } else if (id.startsWith('batch:')) await runtime.removeBatch(id.slice(6)); else { if (sessions.find(row => row.id === id)?.batch) await runtime.batch.stop(sessions.find(row => row.id === id)!.batch!.id); await runtime.engine.remove(id); } setConfirmDelete(null); }
    catch (cause) { setError(clientError(cause)); }
    finally {
      try {
        const remaining = await runtime.repository.listHistory(); const kept = new Set(remaining.map(row => row.id));
        const deleted = new Set(sessions.filter(row => !kept.has(row.id)).map(row => row.id));
        const keptBatches = new Set(remaining.flatMap(row => row.batch ? [row.batch.id] : []));
        const deletedBatches = new Set(sessions.flatMap(row => row.batch && !keptBatches.has(row.batch.id) ? [row.batch.id] : []));
        navigation.forgetRecords(deleted, deletedBatches); setSessions(remaining);
        if (session && deleted.has(session.id)) { loading.current++; setSession(null); setImage(null); await rememberSession(null); }
      } catch (cause) { setError(clientError(cause)); }
      setBusy(false);
    }
  }
  function correct(run: RunView, number?: number) { const result = run.outcome; if (result?.status !== 'completed' && result?.status !== 'needs_clarification') return; setCorrection({ run, text: problemText(result.candidate.problem).slice(0, 2000), ...(number === undefined ? {} : { number }) }); }
  const runs = session?.runs ?? []; const threads = questionConversations(runs); const source = photo?.uri ?? image; const hasAnswers = runs.length > 0;
  const selectedKey = (selectedQuestion?.sessionId === session?.id && threads.some(thread => thread.key === selectedQuestion?.key) ? selectedQuestion?.key : null) ?? threads.find(thread => thread.number !== undefined)?.key ?? threads[0]?.key ?? '';
  const pendingPanels = threads.filter(thread => thread.key === selectedKey).some(thread => {
    const last = thread.runs.findLast(run => !isAuxiliaryContext(run.context?.kind)); const status = last?.outcome?.status;
    return (status === 'completed' || status === 'needs_clarification') && !readyPanels.has(`${thread.key}:${last?.id}`);
  });
  useEffect(() => {
    if (!restored || !batchView && pendingPanels || startupReported.current) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { startupReported.current = true; onReady(); }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [restored, pendingPanels, onReady, batchView]);
  return <SafeAreaView onTouchEnd={navigation.resetExit} style={styles.shell} edges={['top', 'left', 'right', 'bottom']}>
    {appTab === 'questions' && <View style={styles.questionTabs}>
      {(['solve', 'history'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'solve' ? '当前题目' : '历史题目'} accessibilityState={{ selected: tab === value }} aria-selected={tab === value} onPress={() => { setTab(value); if (value === 'history') void list().catch(cause => setError(clientError(cause))); }} style={[styles.questionTab, tab === value && styles.questionTabActive]}><Text style={[styles.questionTabText, tab === value && { color: colors.ink, fontWeight: '700' }]}>{value === 'solve' ? '当前题目' : '历史题目'}</Text></Pressable>)}
    </View>}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={{ flex: 1, backgroundColor: colors.background, display: appTab === 'questions' && tab === 'solve' ? 'flex' : 'none' }}>{batchView ? <BatchWorkspace key={batchView.id} runtime={runtime} batch={batchView} active={navigation.route.page === 'current'} /> : <>{hasAnswers && error ? <Notice text={error} error /> : null}<ScrollView style={{ display: hasAnswers ? 'none' : 'flex' }} ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error ? <Notice text={error} error /> : null}
      {!!source && <Text testID="current-exam" style={[s.subtitle, { fontSize: 12 }]}>{session ? `本题考试：${EXAM_LABELS[sessionExam]}` : `新题默认考试：${EXAM_LABELS[runtime.settings?.exam ?? 'general']}`}</Text>}
      {!available && !!source && <View style={s.row}><Text style={[s.subtitle, { flex: 1 }]}>配置模型服务后即可解题，也可先保存题目。</Text><Button title="去设置" secondary onPress={() => setSettingsOpen(true)} /></View>}
      {!!activeId && !active && <Notice text="另一道题正在解答，请在最近题目中查看。" />}
        {!hasAnswers && <Card style={{ borderWidth: 0, padding: source ? 18 : 0 }}>
            {source ? <><Image accessibilityLabel="待解答的题目" source={{ uri: source }} resizeMode="contain" style={{ width: '100%', height: 280, borderRadius: 10, backgroundColor: '#f7f9fc' }} /><View style={s.row}><Button title="放大题图" secondary onPress={() => setViewImage(true)} />{photo && <><Button title="裁切题图" secondary disabled={busy} onPress={() => setEditing(true)} /><Button title="旋转图片" secondary disabled={busy} onPress={() => void rotate()} /></>}<Button title="换一道题" secondary disabled={busy} onPress={reset} /></View></>
              : <EmptyState kind="camera" title="把题目拍清楚" description="拍下题目，让答案与思路一起展开。"><Button title="拍一张" onPress={() => setCamera(true)} disabled={busy} /><Button title="从相册选择" secondary onPress={() => void gallery()} disabled={busy} />{!runtime.settings && <Button title="配置模型与考试类型" secondary onPress={() => setSettingsOpen(true)} />}</EmptyState>}

            {!hasAnswers && !!source && <><Text style={s.label}>补充说明（选填）</Text><TextInput accessibilityLabel="补充说明" value={message} onChangeText={setMessage} multiline maxLength={2000} editable={!busy} placeholder="例如：解答第 1、2 题，或说明哪里没看懂" style={s.input} /><Button title={busy ? '正在处理…' : available ? '开始解题' : '保存题目'} disabled={busy || !source} onPress={() => void submit()} /></>}
        </Card>}
    </ScrollView>{session && hasAnswers && <QuestionReader key={session.id} threads={threads} selected={selectedKey} onSelect={key => setSelectedQuestion({ sessionId: session.id, key })} {...{ image, busy }} connection="" onAnswerReady={answerReady} imageSize={session.upload} activeId={activeId} available={available} onViewOriginal={async () => setViewImage(true)} onSubmit={submit} onDiagnostics={id => { void runtime.repository.diagnostics(id).then(setDiagnostics).catch(() => setError('诊断读取失败。')); }} onCorrect={correct} onCancel={() => void cancel()} onRefresh={() => { void openSession(session.id, 'refresh'); }} />}</>}</View>
    <View style={{ flex: 1, display: appTab === 'questions' && tab === 'history' ? 'flex' : 'none' }}><View style={[styles.content, { flex: 1, minHeight: 0 }]}>
      {error ? <Notice text={error} error /> : null}
      <HistoryToolbar kind={historyKind} onKind={value => { setHistoryKind(value); resetHistoryScroll(); }} query={historySearch} onQuery={value => { setHistorySearch(value); resetHistoryScroll(); }} />
      <ScrollView ref={historyScroll} keyboardShouldPersistTaps="handled" style={{ flex: 1, display: historyKind === 'batch' ? 'flex' : 'none' }}><BatchHistory rows={sessions} query={historySearch.trim()} disabled={busy} onOpen={setBatchView} onRename={async (id, title) => { await runtime.repository.renameBatch(id, title); await list(); }} onRemove={id => setConfirmDelete(`batch:${id}`)} /></ScrollView>
      <View style={{ flex: 1, minHeight: 0, display: historyKind === 'single' ? 'flex' : 'none' }}>{!!sessions.length && <View style={s.row}><Text style={[s.subtitle, { flex: 1 }]}>{sessions.filter(row => !row.batch).length} 条记录</Text><Button title="清空历史" compact secondary danger disabled={busy} onPress={() => { setError(''); setConfirmDelete('all'); }} /></View>}
        {!sessions.some(row => !row.batch) && <EmptyState kind="history" title="还没有解题记录" description="从第一道题开始，把每一次弄懂都留下来。"><Button title="拍一道题" onPress={() => setCamera(true)} disabled={busy || !!activeId} /></EmptyState>}
        {!!sessions.length && historyMounted && <HistoryPanel viewport filterKey={historySearch} onPageChange={resetHistoryScroll} loadThumbnail={loadThumbnail} sessions={sessions.filter(row => !row.batch && row.text.toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase()))} currentId={session?.id ?? null} disabled={busy} onOpen={openSession} onFavorite={favorite} onRemove={requestRemove} />}
      </View>
    </View></View>
    <View style={{ flex: 1, display: appTab === 'profile' ? 'flex' : 'none' }}>
      {profileSection === 'favorites' ? <View style={[styles.content, { flex: 1, minHeight: 0 }]}>
        <Text accessibilityRole="header" style={[s.title, { marginVertical: 12, marginHorizontal: 8 }]}>收藏的题目</Text>
        {error ? <Notice text={error} error /> : null}
        {sessions.some(item => item.favorite) ? <HistoryPanel viewport onPageChange={resetProfileScroll} loadThumbnail={loadThumbnail} sessions={sessions.filter(item => item.favorite)} currentId={session?.id ?? null} disabled={busy} onOpen={openSession} onFavorite={favorite} onRemove={requestRemove} /> : <EmptyState kind="favorites" title="收藏值得再看的题" description="在历史题目中左滑收藏，把好题和关键思路收进这里。"><Button title="去历史题目" secondary onPress={() => setTab('history')} /></EmptyState>}
      </View> : <ScrollView ref={profileScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><Profile onExport={() => { if (!busy && !runtime.batch.busy && runtime.engine.actives.length === 0) setExportOpen(true); }} count={sessions.length} favoriteCount={sessions.filter(item => item.favorite).length} settingsDisabled={busy || !!activeId || batchBusy} onSettings={() => setSettingsOpen(true)} onHelp={() => setHelp(true)} onFavorites={() => { setProfileSection('favorites'); void list().catch(cause => setError(clientError(cause))); }} onHistory={() => { setTab('history'); void list().catch(cause => setError(clientError(cause))); }} /></ScrollView>}
    </View>
    </KeyboardAvoidingView>
    <AppNavigation tab={appTab} onTab={setAppTab} onCamera={() => setCamera(true)} cameraDisabled={busy || !!activeId && !batchBusy} />
    {exportOpen && <HistoryExport repository={runtime.repository} onClose={() => setExportOpen(false)} />}
    {settingsOpen && <Settings runtime={runtime} onClose={() => setSettingsOpen(false)} onSaved={updateAvailability} />}
    {viewImage && source && <ImageViewer uri={source} size={photo ?? session?.upload ?? { width: 1, height: 1 }} onClose={() => setViewImage(false)} />}
    {camera && <CaptureFlow runtime={runtime} onPhoto={choose} onClose={batch => { setCamera(false); if (batch) setBatchView(batch); void list().catch(cause => setError(clientError(cause))); }} onGallery={() => void gallery()} />}
    {editing && photo && <PhotoEditor photo={photo} onApply={value => { setPhoto(value); setEditing(false); }} onClose={() => setEditing(false)} />}
    {diagnostics && <DiagnosticDetails entries={diagnostics} onClose={() => setDiagnostics(null)} />}
    <Modal visible={!!correction} animationType="slide" onRequestClose={() => setCorrection(null)}><SafeAreaView style={styles.modal}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }}><Text style={s.title}>更正题干</Text><Text style={s.subtitle}>修改识别错误的数字、符号或条件，旧解答会保留。</Text>{correction && <FormulaEditor key={`${correction.run.id}:${correction.number ?? 0}`} value={correction.text} onChange={text => setCorrection(value => value ? { ...value, text } : null)} disabled={busy || !!active} />}{error && <Notice text={error} error />}<Button title="按更正重新解答" disabled={busy || !!active || !correction?.text.trim() || !available} onPress={() => { if (correction) void submit('请根据题干更正重新解答，并说明采用的更正。', { kind: 'correction', sourceRunId: correction.run.id, text: correction.text, ...(correction.number === undefined ? {} : { number: correction.number }) }); }} /><Button title="取消更正" secondary onPress={() => setCorrection(null)} /></ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>
    <Modal visible={!!confirmDelete} transparent animationType="fade" onRequestClose={() => { if (!busy) setConfirmDelete(null); }}><View style={styles.scrim}><Card><Text style={s.title}>{confirmDelete === 'all' ? `清空全部 ${sessions.length} 道题？` : confirmDelete?.startsWith('batch:') ? '删除这一批全部题图与解答？' : '删除这道题？'}</Text><Text style={s.subtitle}>{confirmDelete === 'all' ? '将永久删除本机全部历史题图、解答、收藏和诊断记录，无法撤销。进行中的任务会取消，模型设置保留。已导出的文件仍保留。' : '将从本机永久移除题图、解答和收藏，无法撤销；进行中的任务也会取消。'}</Text>{error ? <Notice text={error} error /> : null}<Button title={confirmDelete === 'all' ? '确认清空全部历史' : '确认删除'} danger disabled={busy} onPress={() => void remove()} /><Button title="保留题目" secondary disabled={busy} onPress={() => setConfirmDelete(null)} /></Card></View></Modal>
    <Modal visible={help} animationType="slide" onRequestClose={() => setHelp(false)}><SafeAreaView style={styles.modal}><ScrollView contentContainerStyle={{ gap: 18 }}><Text style={s.title}>使用说明</Text><Text style={s.subtitle}>1. 打开相机后，可选择“单题拍照”或“批量解题”。单题拍照可确认、裁切，再提交解题；也可从相册选择。{ '\n\n' }2. 批量模式可连续拍摄或逐张选相册题图。每张保存后自动在后台解题并独立核验，无需等待答案即可拍下一张。完成拍摄后进入本批题目，后台解题继续进行。每张建议拍一道完整题，每批最多100张，同时最多处理3张；自动核验会增加模型调用。{ '\n\n' }3. 一次批量拍摄自动归入同一批，默认名称为日期、小时及编号。安卓批量模式对焦后保持焦点；移动到下一题或改变距离后，将题目放在画面中央，点一下预览重新对焦。点击相机顶部或批次详情中的名称可修改，也可在历史批次操作中重命名。{ '\n\n' }4. 历史分为“单题记录”和“批量记录”。点击放大镜展开搜索，可输入原题号、题干关键词或批次名称；收起搜索会清除筛选。批次内的更多操作可继续拍摄、添加图片、继续待解题、重试失败题或停止后台任务。从历史或收藏打开题目后，系统返回回到来源列表；返回到首页后，2秒内连续返回两次才退出。{ '\n\n' }5. 在设置中选择默认考试（SAT、ACT、AP或未指定），新题沿用该配置，旧题保留原考试信息。同图最多4题，请在补充说明里注明题号。答案先显示核心结果，详细步骤、知识点和校验按需查看；“尚未验证”不等于答案正确。{ '\n\n' }6. 安卓解题时可息屏或切换应用，完成后自动保存。若系统关闭应用，中断任务需手动重试；网页版请保持页面打开。{ '\n\n' }7. 题图和对话仅保存在本机，最多保存500张，不会自动删除旧题。卸载或清除数据会丢失记录，可在“我的”导出备份。解题需要联网，题图会发送至你配置的模型服务。</Text><Button title="明白了" onPress={() => setHelp(false)} /></ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#fff' },
  questionTabs: { flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 920, gap: 4, paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4, backgroundColor: '#fff' },
  questionTab: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 22 }, questionTabActive: { backgroundColor: '#edf3ff' }, questionTabText: { fontSize: 16, color: colors.muted },
  content: { padding: 10, paddingBottom: 20, gap: 10, width: '100%', maxWidth: 920, alignSelf: 'center' },
  modal: { flex: 1, padding: 20, backgroundColor: '#fff' }, scrim: { flex: 1, padding: 24, backgroundColor: '#17233866', alignItems: 'center', justifyContent: 'center' },
});
