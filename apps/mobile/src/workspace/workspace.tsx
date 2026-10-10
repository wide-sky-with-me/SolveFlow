// Decision: .agents/notes/implemented/architecture/2026-10-09-overall-study-timer.md
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import { clientError } from '@solveflow/client/presentation';
import { Pressable, Text, View, SafeAreaView } from '../theme/primitives';
import { Button, Notice, colors, s } from '../components/ui';
import { PendingSaves } from '../components/pending-saves';
import { HistoryMaintenance } from '../components/history-maintenance';
import { HistoryImport } from '../components/history-import';
import { HistoryExport } from '../components/history-export';
import { Settings } from '../components/settings';
import { ImageViewer } from '../components/image-viewer';
import { CaptureFlow } from '../components/batch-capture';
import { PhotoEditor } from '../components/photo-editor';
import { DiagnosticDetails } from '../components/diagnostic-details';
import { StudyStopwatch } from '../components/study-stopwatch';
import { AppNavigation } from '../components/app-navigation';
import type { Runtime } from '../runtime';
import { useWorkspaceState } from './use-workspace-state';
import { useWorkspaceActions } from './use-workspace-actions';
import { CurrentQuestionPage, HistoryPage, ProfilePage } from './pages';
import { CorrectionModal, DeleteModal, HelpModal } from './dialogs';
import { styles } from './styles';
import { getRecentSessionWarning, subscribeRecentSessionWarning } from '../local/recent-session-warning';

export function Workspace({ runtime, onReady }: { runtime: Runtime; onReady: () => void }) {
  const state = useWorkspaceState(runtime, onReady);
  const actions = useWorkspaceActions(runtime, state);
  const recentSessionWarning = useSyncExternalStore(subscribeRecentSessionWarning, getRecentSessionWarning, getRecentSessionWarning);
  const {
    available, settingsOpen, setSettingsOpen, navigation, appTab,
    tab, setTab, setAppTab, sessions, session,
    photo, setPhoto, image, error, setError,
    busy, camera, setCamera, editing, setEditing,
    setBatchView, batchBusy, exportOpen, setExportOpen, importOpen,
    setImportOpen, repairSessionId, setRepairSessionId, maintenanceOpen, setMaintenanceOpen,
    issueCount, setIssueCount, unsavedCount, diagnostics, setDiagnostics, correction,
    setCorrection, confirmDelete, setConfirmDelete, help, setHelp,
    viewImage, setViewImage, activeId, active, list,
    updateAvailability, source,
  } = state;
  const { choose, gallery, submit, remove } = actions;

  return (
    <SafeAreaView testID="workspace-shell" onTouchEnd={navigation.resetExit} style={styles.shell} edges={['top', 'left', 'right', 'bottom']}>
      <View testID="workspace-timer-bar" style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.line }}><StudyStopwatch runtime={runtime} /></View>
      {(runtime.settingsWarning || recentSessionWarning) && <View testID="workspace-status" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[s.subtitle, { flex: 1 }]}>{[runtime.settingsWarning, recentSessionWarning].filter(Boolean).join('\n')}</Text>
        {runtime.settingsWarning && <Button title="重新配置模型" compact secondary disabled={busy || !!activeId || batchBusy || unsavedCount > 0} onPress={() => setSettingsOpen(true)} />}
      </View>}
      {unsavedCount > 0 && <PendingSaves engine={runtime.engine} count={unsavedCount} onSaved={() => { setError(''); void list().catch(cause => setError(clientError(cause))); }} />}
      {issueCount > 0 && <View testID="storage-maintenance-notice" style={{ padding: 8, gap: 4 }}><Text style={s.subtitle}>{issueCount} 处本地记录需要处理，原数据已保留。</Text><Button title="查看记录维护" secondary disabled={busy || !!activeId || batchBusy || unsavedCount > 0} onPress={() => setMaintenanceOpen(true)} /></View>}
      {appTab === 'questions' && (
        <View testID="question-tabs" style={styles.questionTabs}>
          {(['solve', 'history'] as const).map(value => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={value === 'solve' ? '当前题目' : '历史题目'}
              accessibilityState={{ selected: tab === value }}
              aria-selected={tab === value}
              onPress={() => {
                setTab(value);
                if (value === 'history') void list(true).catch(cause => setError(clientError(cause)));
              }}
              style={[styles.questionTab, tab === value && styles.questionTabActive]}
            >
              <Text style={[styles.questionTabText, tab === value && { color: colors.ink, fontWeight: '700' }]}>
                {value === 'solve' ? '当前题目' : '历史题目'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <CurrentQuestionPage runtime={runtime} state={state} actions={actions} />
        <HistoryPage runtime={runtime} state={state} actions={actions} />
        <ProfilePage runtime={runtime} state={state} actions={actions} />
      </KeyboardAvoidingView>

      <AppNavigation
        tab={appTab}
        exam={runtime.settings?.exam ?? 'general'}
        onTab={setAppTab}
        onCamera={() => setCamera(true)}
        cameraDisabled={busy || unsavedCount > 0 || (!!activeId && !batchBusy)}
      />

      {/* Floating overlays */}
      {maintenanceOpen && <HistoryMaintenance repository={runtime.repository} onChanged={() => { void list(true).catch(cause => setError(clientError(cause))); }} onClose={() => setMaintenanceOpen(false)} onExport={() => { setMaintenanceOpen(false); setExportOpen(true); }} onRestore={id => { setRepairSessionId(id); setMaintenanceOpen(false); setImportOpen(true); }} />}
      {importOpen && <HistoryImport repository={runtime.repository} repairSessionId={repairSessionId} onClose={() => { setImportOpen(false); setRepairSessionId(undefined); void list(true).catch(cause => setError(clientError(cause))); }} />}
      {exportOpen && <HistoryExport repository={runtime.repository} onClose={() => { setExportOpen(false); setIssueCount(runtime.repository.issues.length); }} />}
      {settingsOpen && (
        <Settings runtime={runtime} onClose={() => setSettingsOpen(false)} onSaved={updateAvailability} />
      )}
      {viewImage && source && (
        <ImageViewer
          uri={source}
          size={photo ?? session?.upload ?? { width: 1, height: 1 }}
          onClose={() => setViewImage(false)}
        />
      )}
      {camera && (
        <CaptureFlow
          runtime={runtime}
          onPhoto={choose}
          onClose={batch => {
            setCamera(false);
            if (batch) setBatchView(batch);
            void list().catch(cause => setError(clientError(cause)));
          }}
          onGallery={() => void gallery()}
        />
      )}
      {editing && photo && (
        <PhotoEditor
          photo={photo}
          onApply={value => { setPhoto(value); setEditing(false); }}
          onClose={() => setEditing(false)}
        />
      )}
      {diagnostics && <DiagnosticDetails entries={diagnostics} onClose={() => setDiagnostics(null)} />}

      {/* Question dialogs */}
      <CorrectionModal
        correction={correction}
        busy={busy}
        active={active}
        available={available}
        error={error}
        runtime={runtime}
        onClose={() => setCorrection(null)}
        onSubmit={imageEdit => {
          if (correction)
            void submit('请根据题干更正重新解答，并说明采用的更正。', {
              kind: 'correction',
              sourceRunId: correction.run.id,
              text: correction.text,
              ...(correction.number === undefined ? {} : { number: correction.number }),
            }, false, imageEdit);
        }}
        onChange={text => setCorrection(value => value ? { ...value, text } : null)}
      />
      <DeleteModal
        confirmDelete={confirmDelete}
        hasStorageIssues={issueCount > 0}
        sessions={sessions}
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
        onClose={() => { if (!busy) setConfirmDelete(null); }}
      />
      <HelpModal visible={help} onClose={() => setHelp(false)} />
    </SafeAreaView>
  );
}
