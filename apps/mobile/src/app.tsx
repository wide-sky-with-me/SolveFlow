import { problemText } from "@solveflow/contracts/agent";
import { ThemeProvider } from './theme/provider';
import { Image, Pressable, ScrollView, Text, TextInput, View, SafeAreaView } from './theme/primitives';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, KeyboardAvoidingView, Modal, Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { z } from 'zod';
import { isAuxiliaryContext, terminal, type RunContext, type RunView, type SessionView } from '@solveflow/contracts/http';
import type { LocalDiagnostic } from '@solveflow/contracts/local';
import { DiagnosticDetails } from './components/diagnostic-details';
import { clientError, questionConversations, type LocalSessionView } from '@solveflow/client';
import { createRuntime, type Runtime } from './runtime';
import { initialSession, rememberSession, photoData, pickPhoto, recoverPhoto, releasePhoto, transformPhoto } from './platform';
import type { Photo } from './platform.types';
import { Camera } from './components/camera';
import { ImageViewer } from './components/image-viewer';
import { FormulaEditor } from './components/formula-editor';
import { PhotoEditor } from './components/photo-editor';
import { HistoryPanel } from './components/history-panel';
import { QuestionPager } from './components/question-pager';
import { QuestionThread } from './components/question-thread';
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
  const [launched, setLaunched] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const finishLaunch = useCallback(() => setLaunched(true), []);
  const finishRestoring = useCallback(() => setWorkspaceReady(true), []);
  useEffect(() => { let alive = true; void createRuntime().then(value => { if (alive) setRuntime(value); }).catch(cause => { if (alive) setError(clientError(cause)); }); return () => { alive = false; }; }, []);
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>{runtime ? <Workspace runtime={runtime} onReady={finishRestoring} /> : error ? <SafeAreaView style={styles.shell}><Card><Text style={s.title}>暂时无法打开题目</Text><Notice text={error} error /></Card></SafeAreaView> : <View style={styles.shell} />}{!launched && <LaunchScreen ready={workspaceReady || !!error} onFinished={finishLaunch} />}</SafeAreaProvider>;
}
function Workspace({ runtime, onReady }: { runtime: Runtime; onReady: () => void }) {
  const [selectedQuestion, setSelectedQuestion] = useState<{ sessionId: string; key: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const [readyPanels, setReadyPanels] = useState<ReadonlySet<string>>(new Set());
  const startupReported = useRef(false);
  const answerReady = useCallback((key: string) => { if (startupReported.current) return; setReadyPanels(current => current.has(key) ? current : new Set([...current, key])); }, []);
  const [available, setAvailable] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false);
  const [appTab, setAppTab] = useState<AppTab>('questions');
  const [profileSection, setProfileSection] = useState<'main' | 'favorites'>('main');
  const [sessions, setSessions] = useState<LocalSessionView[]>([]);
  const [session, setSession] = useState<SessionView | null>(null); const [photo, setPhoto] = useState<Photo | null>(null); const [image, setImage] = useState<string | null>(null);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [camera, setCamera] = useState(false); const [editing, setEditing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LocalDiagnostic[] | null>(null);
  const [tab, setTab] = useState<'solve' | 'history'>('solve'); const [correction, setCorrection] = useState<Correction | null>(null); const [confirmDelete, setConfirmDelete] = useState<string | null>(null); const [help, setHelp] = useState(false);
  const [viewImage, setViewImage] = useState(false); const [activeId, setActiveId] = useState<string | null>(null);
  const locked = useRef(false); const scroll = useRef<ScrollView>(null); const alive = useRef(true); const loading = useRef(0);
  const active = session?.runs.find(run => !terminal(run.status) && !isAuxiliaryContext(run.context?.kind)) ?? null;
  useEffect(() => () => releasePhoto(photo), [photo]);
  const list = useCallback(async () => { const value = await runtime.repository.list(); if (alive.current) setSessions(value); }, [runtime]);
  const loadThumbnail = useCallback(async (id: string) => {
    const record = await runtime.repository.read(id);
    const photo = await transformPhoto({ uri: record.image, width: record.session.upload.width, height: record.session.upload.height }, undefined, false, 256);
    try { return await photoData(photo); } finally { releasePhoto(photo); }
  }, [runtime]);
  const updateAvailability = useCallback(() => { void runtime.configured().then(value => { if (alive.current) setAvailable(value); }).catch(() => { if (alive.current) setError('无法读取模型配置。'); }); }, [runtime]);
  const openSession = useCallback(async (id: string) => {
    const ticket = ++loading.current; setBusy(true); setError('');
    try { const record = await runtime.repository.read(id); if (!alive.current || ticket !== loading.current) return;
      for (const running of runtime.engine.actives) if (running.sessionId === id) record.session.runs = record.session.runs.map(run => run.id === running.id ? running : run);
      await rememberSession(id); setSession(record.session); setImage(record.image); setPhoto(null); setMessage(''); setAppTab('questions'); setTab('solve'); scroll.current?.scrollTo({ y: 0 });
    } catch (cause) { if (alive.current && ticket === loading.current) setError(clientError(cause)); }
    finally { if (alive.current && ticket === loading.current) setBusy(false); }
  }, [runtime]);
  const updateRun = useCallback((run: RunView) => { if (!alive.current) return; setActiveId(runtime.engine.actives.find(item => !terminal(item.status))?.id ?? null); setSession(current => current?.id === run.sessionId ? { ...current, runs: [...current.runs.filter(item => item.id !== run.id), run].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) } : current); if (terminal(run.status)) void list().catch(() => setError('本地记录刷新失败。')); }, [list, runtime]);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = runtime.engine.subscribe(updateRun); const unsubscribeError = runtime.engine.onError(setError);
    void (async () => { try { const configured = await runtime.configured(); if (!alive.current) return; setAvailable(configured); await list(); const recovered = await recoverPhoto(); if (!alive.current) { releasePhoto(recovered); return; } if (recovered) { setPhoto(recovered); setEditing(true); return; } const id = await initialSession(); if (id && z.uuid().safeParse(id).success) await openSession(id); } catch (cause) { if (alive.current) setError(clientError(cause)); } finally { if (alive.current) setRestored(true); } })();
    const sub = AppState.addEventListener('change', value => { if (value === 'background' && Platform.OS === 'ios') void runtime.engine.cancel(); });
    return () => { alive.current = false; unsubscribe(); unsubscribeError(); sub.remove(); if (Platform.OS !== 'android') void runtime.engine.cancel(); };
  }, [runtime, list, openSession, updateRun, updateAvailability, onReady]);
  useEffect(() => { if (Platform.OS === 'web') return; const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (appTab === 'profile' && profileSection === 'favorites') { setProfileSection('main'); return true; } if (appTab !== 'questions') { setAppTab('questions'); return true; } if (tab === 'history') { setTab('solve'); return true; } return false; }); return () => sub.remove(); }, [appTab, tab, profileSection]);
  function reset() { if (locked.current) return; loading.current++; setSession(null); setPhoto(null); setImage(null); setMessage(''); setError(''); setCamera(false); setEditing(false); setViewImage(false); setTab('solve'); void rememberSession(null).catch(cause => setError(clientError(cause))); }
  function choose(value: Photo) { if (locked.current) { releasePhoto(value); return; } loading.current++; setPhoto(value); setSession(null); setImage(null); setMessage(''); setError(''); setAppTab('questions'); setTab('solve'); setCamera(false); setEditing(true); void rememberSession(null).catch(cause => setError(clientError(cause))); }
  async function gallery() { if (busy) return; setCamera(false); try { const value = await pickPhoto(); if (value) { if (alive.current) choose(value); else releasePhoto(value); } } catch { setError('无法读取图片，请选择清晰的题目照片。'); } }
  async function rotate() { if (!photo || busy) return; setBusy(true); try { const value = await transformPhoto(photo, undefined, true); if (alive.current) setPhoto(value); else releasePhoto(value); } catch (cause) { setError(clientError(cause)); } finally { if (alive.current) setBusy(false); } }
  async function submit(text = message, context?: RunContext): Promise<boolean> {
    if (locked.current || busy) return false; if (!isAuxiliaryContext(context?.kind) && (activeId || active)) return false; locked.current = true; setBusy(true); setError('');
    try {
      let current = session;
      if (!current) { if (!photo) throw new Error('请先拍摄或选择题目照片。'); const normalized = await transformPhoto(photo);
        try { const record = await runtime.engine.create(await photoData(normalized), normalized.width, normalized.height); current = record.session; setImage(record.image); setSession(current); setPhoto(null); await rememberSession(current.id); await list(); } finally { releasePhoto(normalized); }
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
    try { await runtime.engine.remove(id); setConfirmDelete(null); if (session?.id === id) { const previousTab = tab; reset(); setTab(previousTab); } await list(); }
    catch (cause) { setError(clientError(cause)); } finally { setBusy(false); }
  }
  function correct(run: RunView, number?: number) { const result = run.outcome; if (result?.status !== 'completed' && result?.status !== 'needs_clarification') return; setCorrection({ run, text: problemText(result.candidate.problem).slice(0, 2000), ...(number === undefined ? {} : { number }) }); }
  const runs = session?.runs ?? []; const threads = questionConversations(runs); const source = photo?.uri ?? image; const hasAnswers = runs.length > 0;
  const selectedKey = (selectedQuestion?.sessionId === session?.id && threads.some(thread => thread.key === selectedQuestion?.key) ? selectedQuestion?.key : null) ?? threads.find(thread => thread.number !== undefined)?.key ?? threads[0]?.key ?? '';
  const pendingPanels = threads.filter(thread => thread.key === selectedKey).some(thread => {
    const last = thread.runs.findLast(run => !isAuxiliaryContext(run.context?.kind)); const status = last?.outcome?.status;
    return (status === 'completed' || status === 'needs_clarification') && !readyPanels.has(`${thread.key}:${last?.id}`);
  });
  useEffect(() => {
    if (!restored || pendingPanels || startupReported.current) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { startupReported.current = true; onReady(); }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [restored, pendingPanels, onReady]);
  return <SafeAreaView style={styles.shell} edges={['top', 'left', 'right', 'bottom']}>
    {appTab === 'questions' && <View style={styles.questionTabs}>
      {(['solve', 'history'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'solve' ? '当前题目' : '历史题目'} accessibilityState={{ selected: tab === value }} aria-selected={tab === value} onPress={() => { setTab(value); if (value === 'history') void list().catch(cause => setError(clientError(cause))); }} style={[styles.questionTab, tab === value && styles.questionTabActive]}><Text style={[styles.questionTabText, tab === value && { color: colors.ink, fontWeight: '700' }]}>{value === 'solve' ? '当前题目' : '历史题目'}</Text></Pressable>)}
    </View>}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={{ flex: 1, backgroundColor: colors.background, display: appTab === 'questions' && tab === 'solve' ? 'flex' : 'none' }}>{hasAnswers && error ? <Notice text={error} error /> : null}<ScrollView style={{ display: hasAnswers ? 'none' : 'flex' }} ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error ? <Notice text={error} error /> : null}
      {!available && !!source && <View style={s.row}><Text style={[s.subtitle, { flex: 1 }]}>配置模型服务后即可解题，也可先保存题目。</Text><Button title="去设置" secondary onPress={() => setSettingsOpen(true)} /></View>}
      {!!activeId && !active && <Notice text="另一道题正在解答，请在最近题目中查看。" />}
        {!hasAnswers && <Card style={{ borderWidth: 0, padding: source ? 18 : 0 }}>
          {source && <><Text style={s.title}>拍照解题</Text><Text style={s.subtitle}>拍清题目，查看分步解析</Text></>}
            {source ? <><Image accessibilityLabel="待解答的题目" source={{ uri: source }} resizeMode="contain" style={{ width: '100%', height: 280, borderRadius: 10, backgroundColor: '#f7f9fc' }} /><View style={s.row}><Button title="放大题图" secondary onPress={() => setViewImage(true)} />{photo && <><Button title="裁切题图" secondary disabled={busy} onPress={() => setEditing(true)} /><Button title="旋转图片" secondary disabled={busy} onPress={() => void rotate()} /></>}<Button title="换一道题" secondary disabled={busy} onPress={reset} /></View></>
              : <EmptyState kind="camera" title="把题目拍清楚" description="拍下题目，让答案与思路一起展开。"><Button title="拍一张" onPress={() => setCamera(true)} disabled={busy} /><Button title="从相册选择" secondary onPress={() => void gallery()} disabled={busy} /></EmptyState>}

            {!hasAnswers && !!source && <><Text style={s.label}>补充说明（选填）</Text><TextInput accessibilityLabel="补充说明" value={message} onChangeText={setMessage} multiline maxLength={2000} editable={!busy} placeholder="例如：解答第 1、2 题，或说明哪里没看懂" style={s.input} /><Text style={s.subtitle}>同图最多 4 题，请注明题号</Text><Button title={busy ? '正在处理…' : available ? '开始解题' : '保存题目'} disabled={busy || !source} onPress={() => void submit()} /></>}
        </Card>}
    </ScrollView>{session && hasAnswers && <QuestionPager key={session.id} threads={threads} selected={selectedKey} onSelect={key => setSelectedQuestion({ sessionId: session.id, key })} render={(thread, onSwipe) => <QuestionThread {...{ thread, image, busy }} onPageSwipe={onSwipe} connection="" onAnswerReady={answerReady} imageSize={session.upload} activeId={activeId} available={available} onViewOriginal={async () => setViewImage(true)} onSubmit={submit} onDiagnostics={id => { void runtime.repository.diagnostics(id).then(setDiagnostics).catch(() => setError('诊断读取失败。')); }} onCorrect={correct} onCancel={() => void cancel()} onRefresh={() => { void openSession(session.id); }} />} />}</View>
    <View style={{ flex: 1, display: appTab === 'questions' && tab === 'history' ? 'flex' : 'none' }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error ? <Notice text={error} error /> : null}
      <Card style={{ borderWidth: 0, paddingTop: 0 }}>{!sessions.length && <EmptyState kind="history" title="还没有解题记录" description="从第一道题开始，把每一次弄懂都留下来。"><Button title="拍一道题" onPress={() => setCamera(true)} disabled={busy || !!activeId} /></EmptyState>}{!!sessions.length && appTab === 'questions' && tab === 'history' && <HistoryPanel loadThumbnail={loadThumbnail} sessions={sessions} currentId={session?.id ?? null} disabled={busy} onOpen={openSession} onFavorite={favorite} onRemove={requestRemove} />}</Card>
    </ScrollView></View>
    <View style={{ flex: 1, display: appTab === 'profile' ? 'flex' : 'none' }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {profileSection === 'favorites' ? <>
        <Text accessibilityRole="header" style={[s.title, { marginVertical: 12, marginHorizontal: 8 }]}>收藏的题目</Text>
        {error ? <Notice text={error} error /> : null}
        {sessions.some(item => item.favorite) ? appTab === 'profile' && <HistoryPanel loadThumbnail={loadThumbnail} sessions={sessions.filter(item => item.favorite)} currentId={session?.id ?? null} disabled={busy} onOpen={openSession} onFavorite={favorite} onRemove={requestRemove} /> : <EmptyState kind="favorites" title="收藏值得再看的题" description="在历史题目中左滑收藏，把好题和关键思路收进这里。"><Button title="去历史题目" secondary onPress={() => { setAppTab('questions'); setTab('history'); }} /></EmptyState>}
      </> : <Profile count={sessions.length} favoriteCount={sessions.filter(item => item.favorite).length} settingsDisabled={busy || !!activeId} onSettings={() => setSettingsOpen(true)} onHelp={() => setHelp(true)} onFavorites={() => { setProfileSection('favorites'); void list().catch(cause => setError(clientError(cause))); }} onHistory={() => { setAppTab('questions'); setTab('history'); void list().catch(cause => setError(clientError(cause))); }} />}
    </ScrollView></View>
    </KeyboardAvoidingView>
    <AppNavigation tab={appTab} onTab={value => { setAppTab(value); if (value === 'profile') setProfileSection('main'); }} onCamera={() => setCamera(true)} cameraDisabled={busy || !!activeId} />
    {settingsOpen && <Settings runtime={runtime} onClose={() => setSettingsOpen(false)} onSaved={updateAvailability} />}
    {viewImage && source && <ImageViewer uri={source} size={photo ?? session?.upload ?? { width: 1, height: 1 }} onClose={() => setViewImage(false)} />}
    {camera && <Camera onPhoto={choose} onClose={() => setCamera(false)} onGallery={() => void gallery()} />}
    {editing && photo && <PhotoEditor photo={photo} onApply={value => { setPhoto(value); setEditing(false); }} onClose={() => setEditing(false)} />}
    {diagnostics && <DiagnosticDetails entries={diagnostics} onClose={() => setDiagnostics(null)} />}
    <Modal visible={!!correction} animationType="slide" onRequestClose={() => setCorrection(null)}><SafeAreaView style={styles.modal}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }}><Text style={s.title}>更正题干</Text><Text style={s.subtitle}>修改识别错误的数字、符号或条件，旧解答会保留。</Text>{correction && <FormulaEditor key={`${correction.run.id}:${correction.number ?? 0}`} value={correction.text} onChange={text => setCorrection(value => value ? { ...value, text } : null)} disabled={busy || !!active} />}{error && <Notice text={error} error />}<Button title="按更正重新解答" disabled={busy || !!active || !correction?.text.trim() || !available} onPress={() => { if (correction) void submit('请根据题干更正重新解答，并说明采用的更正。', { kind: 'correction', sourceRunId: correction.run.id, text: correction.text, ...(correction.number === undefined ? {} : { number: correction.number }) }); }} /><Button title="取消更正" secondary onPress={() => setCorrection(null)} /></ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>
    <Modal visible={!!confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(null)}><View style={styles.scrim}><Card><Text style={s.title}>删除这道题？</Text><Text style={s.subtitle}>将从本机永久移除题图、解答和收藏，无法撤销；进行中的任务也会取消。</Text>{error ? <Notice text={error} error /> : null}<Button title="确认删除" danger disabled={busy} onPress={() => void remove()} /><Button title="保留题目" secondary onPress={() => setConfirmDelete(null)} /></Card></View></Modal>
    <Modal visible={help} animationType="slide" onRequestClose={() => setHelp(false)}><SafeAreaView style={styles.modal}><ScrollView contentContainerStyle={{ gap: 18 }}><Text style={s.title}>使用说明</Text><Text style={s.subtitle}>1. 拍照或选择相册中的题目，确认并裁切。{ '\n\n' }2. 自动识别科目；同图最多 4 题，请注明题号。{ '\n\n' }3. 阅读原题、分步解答和知识点，在对应题目下面继续追问。{ '\n\n' }4. 安卓解题时可息屏或切换应用，完成后自动保存。若系统关闭应用，中断任务可手动重试；网页版请保持页面打开。{ '\n\n' }5. 题图和对话仅保存在本机。卸载应用或清除浏览器数据会丢失记录；可以在历史题目中主动删除。解题需要联网，题图会发送至你设置的模型服务。</Text><Button title="明白了" onPress={() => setHelp(false)} /></ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#fff' },
  questionTabs: { flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 920, gap: 4, paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4, backgroundColor: '#fff' },
  questionTab: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 22 }, questionTabActive: { backgroundColor: '#edf3ff' }, questionTabText: { fontSize: 16, color: colors.muted },
  content: { padding: 10, paddingBottom: 20, gap: 10, width: '100%', maxWidth: 920, alignSelf: 'center' },
  modal: { flex: 1, padding: 20, backgroundColor: '#fff' }, scrim: { flex: 1, padding: 24, backgroundColor: '#17233866', alignItems: 'center', justifyContent: 'center' },
});
