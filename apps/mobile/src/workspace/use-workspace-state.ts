import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, type ScrollView } from 'react-native';
import { z } from 'zod';
import { isAuxiliaryContext, terminal, type RunView, type SessionView } from '@solveflow/contracts/http';
import type { ExamType, LocalHistorySummary, LocalDiagnostic } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import { questionConversations } from '@solveflow/client/learning';
import type { Runtime } from '../runtime';
import { initialSession, rememberSession, photoData, recoverPhoto, releasePhoto, transformPhoto } from '../platform';
import type { Photo } from '../platform.types';
import type { AppTab } from '../components/app-navigation';
import type { BatchView } from '../components/batch-workspace';
import { useImageShare } from '../components/use-image-share';
import { useWorkspaceNavigation } from '../use-workspace-navigation';
import { mergeRunUpdate } from '../run-updates';
import type { Correction } from './types';

// Decision: .agents/notes/implemented/architecture/2026-10-05-source-and-build-boundaries.md
export function useWorkspaceState(runtime: Runtime, onReady: () => void) {
  const [selectedQuestion, setSelectedQuestion] = useState<{ sessionId: string; key: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const [readyPanels, setReadyPanels] = useState<ReadonlySet<string>>(new Set());
  const startupReported = useRef(false);
  const answerReady = useCallback((key: string) => {
    if (startupReported.current) return;
    setReadyPanels(current => current.has(key) ? current : new Set([...current, key]));
  }, []);
  const [available, setAvailable] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigation = useWorkspaceNavigation();
  const navigate = navigation.navigate;
  const initialPage = useRef({ route: navigation.route, current: navigation.current }).current;
  const appTab: AppTab = ['profile', 'favorites'].includes(navigation.route.page) ? 'profile' : 'questions';
  const tab = navigation.route.page === 'history' ? 'history' : 'solve';
  const profileSection = navigation.route.page === 'favorites' ? 'favorites' : 'main';
  const batchView = navigation.current.batch ?? null;
  const [jumpGridTrigger, setJumpGridTrigger] = useState(0);
  const setTab = (value: 'solve' | 'history') => navigate(value === 'solve' ? navigation.current : { page: 'history' });
  const setAppTab = (value: AppTab) => {
    if (value === 'questions') {
      if (appTab === 'questions' && tab === 'solve' && batchView) {
        setJumpGridTrigger(count => count + 1);
      } else {
        navigate(navigation.current);
      }
    } else {
      navigate({ page: 'profile' });
    }
  };
  const setProfileSection = (value: 'main' | 'favorites') => navigate({ page: value === 'favorites' ? 'favorites' : 'profile' });
  const [historyMounted, setHistoryMounted] = useState(false);
  const [sessions, setSessions] = useState<LocalHistorySummary[]>([]);
  const [session, setSession] = useState<SessionView | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [sessionExam, setSessionExam] = useState<ExamType>('general');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [editing, setEditing] = useState(false);
  const setBatchView = (batch: BatchView) => navigate({ page: 'current', batch });
  const [historyKind, setHistoryKind] = useState<'single' | 'batch'>('single');
  const [historySearch, setHistorySearch] = useState('');
  const [batchBusy, setBatchBusy] = useState(runtime.batch.busy);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [repairSessionId, setRepairSessionId] = useState<string | undefined>();
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [issueCount, setIssueCount] = useState(runtime.repository.issues.length);
  const [unsavedCount, setUnsavedCount] = useState(runtime.engine.unsavedRuns.length);
  const [diagnostics, setDiagnostics] = useState<LocalDiagnostic[] | null>(null);
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  useEffect(() => { if (appTab === 'questions' && tab === 'history') setHistoryMounted(true); }, [appTab, tab]);

  const [viewImage, setViewImage] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const alive = useRef(true);
  const loading = useRef(0);
  const historyScroll = useRef<ScrollView>(null);
  const profileScroll = useRef<ScrollView>(null);
  const resetHistoryScroll = useCallback(() => historyScroll.current?.scrollTo({ y: 0, animated: false }), []);
  const resetProfileScroll = useCallback(() => profileScroll.current?.scrollTo({ y: 0, animated: false }), []);
  const active = session?.runs.find(run => !terminal(run.status) && !isAuxiliaryContext(run.context?.kind)) ?? null;

  useEffect(() => () => releasePhoto(photo), [photo]);

  const list = useCallback(async (refresh = false) => {
    const value = await runtime.repository.listHistory({ cached: !refresh });
    if (alive.current) { setSessions(value); setIssueCount(runtime.repository.issues.length); }
  }, [runtime]);

  const loadThumbnail = useCallback(async (id: string) => {
    const record = await runtime.repository.read(id);
    const p = await transformPhoto({ uri: record.image, width: record.session.upload.width, height: record.session.upload.height }, undefined, false, 256);
    try { return await photoData(p); } finally { releasePhoto(p); }
  }, [runtime]);

  const updateAvailability = useCallback(() => {
    void runtime.configured().then(value => {
      if (alive.current) setAvailable(value);
    }).catch(() => {
      if (alive.current) setError('无法读取模型配置。');
    });
  }, [runtime]);

  const openSession = useCallback(async (id: string, mode: 'push' | 'restore' | 'refresh' = 'push') => {
    const ticket = ++loading.current;
    setBusy(true);
    setError('');
    try {
      const record = await runtime.repository.read(id);
      if (!alive.current || ticket !== loading.current) return;
      if (record.batch) {
        const { position: _position, ...batch } = record.batch;
        if (mode !== 'refresh') navigate({ page: 'current', batch: { ...batch, selectedId: id } }, mode === 'restore');
        return;
      }
      for (const running of runtime.engine.actives) {
        if (running.sessionId === id)
          record.session.runs = record.session.runs.map(run => run.id === running.id ? running : run);
      }
      if (mode !== 'refresh') navigate({ page: 'current', questionId: id }, mode === 'restore');
      await rememberSession(id);
      setSession(record.session);
      setSessionExam(record.exam ?? 'general');
      setImage(record.image);
      setPhoto(null);
      setMessage('');
      scroll.current?.scrollTo({ y: 0 });
    } catch (cause) {
      if (alive.current && ticket === loading.current) setError(clientError(cause));
    } finally {
      if (alive.current && ticket === loading.current) setBusy(false);
    }
  }, [runtime, navigate]);

  const updateRun = useCallback((run: RunView) => {
    if (!alive.current) return;
    setActiveId(runtime.engine.actives.find(item => !terminal(item.status))?.id ?? null);
    setSession(current =>
      current?.id === run.sessionId
        ? { ...current, runs: mergeRunUpdate(current.runs, run) }
        : current,
    );

  }, [list, runtime]);

  useEffect(() => {
    alive.current = true;
    const unsubscribeBatch = runtime.batch.subscribe(() => {
      if (alive.current) setBatchBusy(runtime.batch.busy);
    });
    const unsubscribeHistory = runtime.repository.subscribeHistory(() => { void list().catch(() => { if (alive.current) setError('本地记录刷新失败。'); }); });
    const unsubscribeIssues = runtime.repository.subscribeIssues(() => { if (alive.current) setIssueCount(runtime.repository.issues.length); });
    const unsubscribe = runtime.engine.subscribe(updateRun);
    const unsubscribeError = runtime.engine.onError(setError);
    const unsubscribeStorage = runtime.engine.subscribeStorage(() => {
      if (alive.current) { setUnsavedCount(runtime.engine.unsavedRuns.length); setActiveId(runtime.engine.actives.find(item => !terminal(item.status))?.id ?? null); }
    });
    void (async () => {
      try {
        const configured = await runtime.configured();
        if (!alive.current) return;
        setAvailable(configured);
        await list();
        const recovered = await recoverPhoto();
        if (!alive.current) { releasePhoto(recovered); return; }
        if (recovered) { setPhoto(recovered); setEditing(true); return; }
        if (initialPage.current.batch) return;
        const id = initialPage.current.questionId ?? await initialSession();
        if (id && z.uuid().safeParse(id).success) await openSession(id, initialPage.route.page === 'current' ? 'restore' : 'refresh');
      } catch (cause) {
        if (alive.current) setError(clientError(cause));
      } finally {
        if (alive.current) setRestored(true);
      }
    })();
    const sub = AppState.addEventListener('change', value => {
      if (value === 'background' && Platform.OS === 'ios')
        void runtime.batch.stop().then(() => runtime.engine.cancel());
    });
    return () => {
      alive.current = false;
      unsubscribe();
      unsubscribeBatch();
      unsubscribeHistory();
      unsubscribeIssues();
      unsubscribeError();
      unsubscribeStorage();
      sub.remove();
      if (Platform.OS !== 'android') void runtime.batch.stop().then(() => runtime.engine.cancel());
    };
  }, [runtime, list, openSession, updateRun, updateAvailability, onReady, initialPage]);

  useEffect(() => {
    if (!restored) return;
    let cancelled = false;
    void (async () => {
      const route = navigation.route;
      if (Platform.OS === 'web') {
        // Browser entries outlive the in-memory history. Existing corrupt records remain targets.
        const ids = new Set(await runtime.repository.recordIds());
        if (cancelled) return;
        const targets = [navigation.current, ...(route.page === 'current' ? [route] : [])];
        const missing = new Set(targets.flatMap(target => target.questionId && !ids.has(target.questionId) ? [target.questionId] : []));
        const uncertainBatch = runtime.repository.issues.some(issue => issue.key.startsWith('record.') && issue.sessionId && ids.has(issue.sessionId));
        const rows = targets.some(target => target.batch) ? await runtime.repository.listHistory({ cached: true }) : sessions;
        if (cancelled) return;
        const batches = new Set(rows.flatMap(row => row.batch ? [row.batch.id] : []));
        const missingBatches = new Set(targets.flatMap(target => target.batch && !batches.has(target.batch.id) && !uncertainBatch ? [target.batch.id] : []));
        for (const target of targets) if (target.batch?.selectedId && !ids.has(target.batch.selectedId)) missing.add(target.batch.selectedId);
        if (missing.size || missingBatches.size) { navigation.forgetRecords(missing, missingBatches); return; }
      }
      if (cancelled || route.page !== 'current') return;
      if (route.questionId && route.questionId !== session?.id) await openSession(route.questionId, 'refresh');
      else if (!route.questionId && !route.batch) {
        loading.current++;
        setBusy(false);
        setSession(null);
        setImage(null);
        await rememberSession(null);
      }
    })().catch(cause => { if (!cancelled) setError(clientError(cause)); });
    return () => { cancelled = true; };
  }, [navigation.route, navigation.current, navigation.forgetRecords, restored, openSession, runtime, sessions]);

  const runs = session?.runs ?? [];
  const threads = useMemo(() => questionConversations(session?.runs ?? []), [session?.runs]);
  const source = photo?.uri ?? image;
  const { share: shareOriginal, error: shareError } = useImageShare(source);
  const hasAnswers = runs.length > 0;
  const selectedKey =
    (selectedQuestion?.sessionId === session?.id &&
      threads.some(thread => thread.key === selectedQuestion?.key)
      ? selectedQuestion?.key
      : null) ??
    threads.find(thread => thread.number !== undefined)?.key ??
    threads[0]?.key ?? '';
  const pendingPanels = threads
    .filter(thread => thread.key === selectedKey)
    .some(thread => {
      const last = thread.runs.findLast(run => !isAuxiliaryContext(run.context?.kind));
      const status = last?.outcome?.status;
      return (
        (status === 'completed' || status === 'needs_clarification') &&
        !readyPanels.has(`${thread.key}:${last?.id}`)
      );
    });

  useEffect(() => {
    if (!restored || (!batchView && pendingPanels) || startupReported.current) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => { startupReported.current = true; onReady(); });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [restored, pendingPanels, onReady, batchView]);

  return {
    setSelectedQuestion, available,
    settingsOpen, setSettingsOpen, navigation, navigate, appTab,
    tab, profileSection, batchView, jumpGridTrigger, setTab,
    setAppTab, setProfileSection, historyMounted, sessions, setSessions,
    session, setSession, photo, setPhoto, image,
    setImage, sessionExam, setSessionExam, message, setMessage,
    error, setError, busy, setBusy, camera,
    setCamera, editing, setEditing, setBatchView, historyKind,
    setHistoryKind, historySearch, setHistorySearch, batchBusy, exportOpen,
    setExportOpen, importOpen, setImportOpen, repairSessionId, setRepairSessionId,
    maintenanceOpen, setMaintenanceOpen, issueCount, setIssueCount, unsavedCount, diagnostics,
    setDiagnostics, correction, setCorrection, confirmDelete, setConfirmDelete,
    help, setHelp, viewImage, setViewImage, activeId,
    scroll, alive, loading, historyScroll, profileScroll,
    resetHistoryScroll, resetProfileScroll, active, list, loadThumbnail,
    updateAvailability, openSession, threads, source, shareOriginal,
    shareError, hasAnswers, selectedKey, answerReady,
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
