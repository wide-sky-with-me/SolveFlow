import { MAX_USER_MESSAGE_CHARACTERS } from '@solveflow/contracts/agent';
import { EXAM_LABELS } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import { Image, Pressable, ScrollView, Text, TextInput, View } from '../theme/primitives';
import { Button, Card, Notice, colors, s } from '../components/ui';
import { BatchWorkspace } from '../components/batch-workspace';
import { QuestionMaterials } from '../components/question-materials';
import { QuestionReader } from '../components/question-reader';
import { EmptyState } from '../components/empty-state';
import { HistoryToolbar } from '../components/history-toolbar';
import { BatchHistory } from '../components/batch-history';
import { HistoryPanel } from '../components/history-panel';
import { Profile } from '../components/profile';
import type { Runtime } from '../runtime';
import type { WorkspaceState } from './use-workspace-state';
import type { WorkspaceActions } from './use-workspace-actions';
import { styles } from './styles';

type PageProps = { runtime: Runtime; state: WorkspaceState; actions: WorkspaceActions };

export function CurrentQuestionPage({ runtime, state, actions }: PageProps) {
  const {
    setSelectedQuestion, available, setSettingsOpen, navigation, appTab,
    tab, batchView, jumpGridTrigger, session, photo,
    image, sessionExam, message, setMessage, error,
    setError, busy, camera, setCamera, setEditing,
    diagnostics, setDiagnostics, setViewImage, activeId, scroll,
    active, openSession, threads, source, shareOriginal,
    shareError, hasAnswers, selectedKey, answerReady,
  } = state;
  const { reset, gallery, rotate, submit, cancel, correct } = actions;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, display: appTab === 'questions' && tab === 'solve' ? 'flex' : 'none' }}>
      {batchView ? (
        <BatchWorkspace
          key={batchView.id}
          runtime={runtime}
          available={available}
          batch={batchView}
          active={navigation.route.page === 'current'}
          jumpGridTrigger={jumpGridTrigger}
        />
      ) : (
        <>
          {hasAnswers && error ? <Notice text={error} error /> : null}
          <ScrollView
            testID="question-scroll"
            style={{ display: hasAnswers ? 'none' : 'flex' }}
            ref={scroll}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {error ? <Notice text={error} error /> : null}

            {!!source && (
              <Text testID="current-exam" style={[s.subtitle, { fontSize: 12 }]}>
                {session
                  ? `本题考试：${EXAM_LABELS[sessionExam]}`
                  : `新题默认考试：${EXAM_LABELS[runtime.settings?.exam ?? 'general']}`}
              </Text>
            )}
            {!available && !!source && (
              <View style={s.row}>
                <Text style={[s.subtitle, { flex: 1 }]}>配置模型服务后即可解题，也可先保存题目。</Text>
                <Button title="去设置" secondary onPress={() => setSettingsOpen(true)} />
              </View>
            )}
            {!!activeId && !active && <Notice text="另一道题正在解答，请在最近题目中查看。" />}
            {!hasAnswers && (
              <Card style={{ borderWidth: 0, padding: source ? 18 : 0 }}>
                {source ? (
                  <>
                    <Pressable accessibilityRole="button" accessibilityLabel="查看题目图片" onPress={() => setViewImage(true)} onLongPress={() => void shareOriginal()}>
                      <Image
                        accessibilityLabel="待解答的题目"
                        source={{ uri: source }}
                        resizeMode="contain"
                        style={{ width: '100%', height: 280, borderRadius: 10, backgroundColor: '#f7f9fc' }}
                      />
                    </Pressable>
                    {!!shareError && <Notice text={shareError} error />}
                    <View style={s.row}>
                      {photo && (
                        <>
                          <Button title="先保存题图以补充材料" secondary disabled={busy} onPress={() => void submit(message, undefined, true)} />
                          <Button title="裁切题图" secondary disabled={busy} onPress={() => setEditing(true)} />
                          <Button title="旋转图片" secondary disabled={busy} onPress={() => void rotate()} />
                        </>
                      )}
                      <Button title="换一道题" secondary disabled={busy} onPress={reset} />
                    </View>
                  </>
                ) : (
                  <EmptyState kind="camera" title="把题目拍清楚">
                    <Button title="拍一张" onPress={() => setCamera(true)} disabled={busy} />
                    <Button title="从相册选择" secondary onPress={() => void gallery()} disabled={busy} />
                    {!runtime.settings && (
                      <Button title="配置模型与考试类型" secondary onPress={() => setSettingsOpen(true)} />
                    )}
                  </EmptyState>
                )}
                {!hasAnswers && !!source && (
                  <>
                    <Text style={s.label}>补充说明（选填）</Text>
                    <TextInput
                      accessibilityLabel="补充说明"
                      value={message}
                      onChangeText={setMessage}
                      multiline
                      maxLength={MAX_USER_MESSAGE_CHARACTERS}
                      editable={!busy}
                      placeholder="例如：解答第 1、2 题，或说明哪里没看懂"
                      style={s.input}
                    />
                    <Button
                      title={busy ? '正在处理…' : available ? '开始解题' : '保存题目'}
                      disabled={busy || !source}
                      onPress={() => void submit()}
                    />
                  </>
                )}
              </Card>
            )}
          </ScrollView>
          {session && <QuestionMaterials key={`materials-${session.id}`} id={session.id} runtime={runtime} disabled={busy || !!activeId || runtime.batch.busy} />}
          {session && hasAnswers && (
            <QuestionReader runtime={runtime}
              key={session.id}
              threads={threads}
              selected={selectedKey}
              onSelect={key => setSelectedQuestion({ sessionId: session.id, key })}
              image={image}
              busy={busy}
              connection=""
              onAnswerReady={answerReady}
              imageSize={session.upload}
              activeId={activeId}
              available={available}
              onViewOriginal={async () => setViewImage(true)}
              backupAvailable={!!runtime.settings?.backup}
              onSubmit={submit}
              onDiagnostics={id => {
                void runtime.repository
                  .diagnostics(id)
                  .then(setDiagnostics)
                  .catch(() => setError('诊断读取失败。'));
              }}
              onCorrect={correct}
              onCancel={runId => void cancel(runId)}
              onRefresh={() => { void openSession(session.id, 'refresh'); }}
            />
          )}
        </>
      )}
    </View>
  );
}

export function HistoryPage({ runtime, state, actions }: PageProps) {
  const {
    appTab, tab, historyMounted, sessions, session,
    error, setError, busy, setCamera, setBatchView,
    historyKind, setHistoryKind, historySearch, setHistorySearch, setConfirmDelete,
    activeId, historyScroll, resetHistoryScroll, list, loadThumbnail,
    openSession,
  } = state;
  const { favorite, requestRemove } = actions;
  return (
    <View testID="history-page" style={{ flex: 1, display: appTab === 'questions' && tab === 'history' ? 'flex' : 'none' }}>
      <View style={[styles.content, { flex: 1, minHeight: 0 }]}>
        {error ? <Notice text={error} error /> : null}
        <HistoryToolbar
          kind={historyKind}
          onKind={value => { setHistoryKind(value); resetHistoryScroll(); }}
          query={historySearch}
          onQuery={value => { setHistorySearch(value); resetHistoryScroll(); }}
        />
        <ScrollView
          ref={historyScroll}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1, display: historyKind === 'batch' ? 'flex' : 'none' }}
        >
          <BatchHistory
            rows={sessions}
            query={historySearch.trim()}
            disabled={busy}
            onOpen={setBatchView}
            onRename={async (id, title) => { await runtime.repository.renameBatch(id, title); await list(); }}
            onRemove={id => setConfirmDelete(`batch:${id}`)}
          />
        </ScrollView>
        <View style={{ flex: 1, minHeight: 0, display: historyKind === 'single' ? 'flex' : 'none' }}>
          {!sessions.some(row => !row.batch) && (
            <EmptyState kind="history" title="还没有解题记录">
              <Button title="拍一道题" onPress={() => setCamera(true)} disabled={busy || !!activeId} />
            </EmptyState>
          )}
          {sessions.some(row => !row.batch) && historyMounted && (
            <HistoryPanel
              viewport
              footer={<View style={s.row}>
                <Text style={s.subtitle}>{sessions.filter(row => !row.batch).length} 条记录</Text>
                <Button title="清空历史" compact secondary danger disabled={busy} onPress={() => { setError(''); setConfirmDelete('all'); }} />
              </View>}
              filterKey={historySearch}
              onPageChange={resetHistoryScroll}
              loadThumbnail={loadThumbnail}
              sessions={sessions.filter(
                row =>
                  !row.batch &&
                  row.text.toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase()),
              )}
              currentId={session?.id ?? null}
              disabled={busy}
              onOpen={openSession}
              onFavorite={favorite}
              onRemove={requestRemove}
            />
          )}
        </View>
      </View>
    </View>
  );
}

export function ProfilePage({ runtime, state, actions }: PageProps) {
  const {
    setSettingsOpen, appTab, profileSection, setTab, setProfileSection,
    sessions, session, error, setError, busy,
    batchBusy, setExportOpen, setImportOpen, unsavedCount, setHelp,
    activeId, profileScroll, resetProfileScroll, list, loadThumbnail,
    openSession,
  } = state;
  const { favorite, requestRemove } = actions;
  return (
    <View style={{ flex: 1, display: appTab === 'profile' ? 'flex' : 'none' }}>
      {profileSection === 'favorites' ? (
        <View style={[styles.content, { flex: 1, minHeight: 0 }]}>
          <Text accessibilityRole="header" style={[s.title, { marginVertical: 12, marginHorizontal: 8 }]}>
            收藏的题目
          </Text>
          {error ? <Notice text={error} error /> : null}
          {sessions.some(item => item.favorite) ? (
            <HistoryPanel
              viewport
              onPageChange={resetProfileScroll}
              loadThumbnail={loadThumbnail}
              sessions={sessions.filter(item => item.favorite)}
              currentId={session?.id ?? null}
              disabled={busy}
              onOpen={openSession}
              onFavorite={favorite}
              onRemove={requestRemove}
            />
          ) : (
            <EmptyState
              kind="favorites"
              title="还没有收藏的题目"
              description="在历史题目的更多操作中收藏。"
            >
              <Button title="去历史题目" secondary onPress={() => setTab('history')} />
            </EmptyState>
          )}
        </View>
      ) : (
        <ScrollView
          testID="profile-scroll"
          ref={profileScroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Profile
            onImport={() => { if (!busy && !runtime.batch.busy && runtime.engine.actives.length === 0) setImportOpen(true); }}
            onExport={() => {
              if (!busy && !runtime.batch.busy && runtime.engine.actives.length === 0) setExportOpen(true);
            }}
            count={sessions.length}
            favoriteCount={sessions.filter(item => item.favorite).length}
            settingsDisabled={busy || !!activeId || batchBusy || unsavedCount > 0}
            onSettings={() => setSettingsOpen(true)}
            onHelp={() => setHelp(true)}
            onFavorites={() => {
              setProfileSection('favorites');
              void list(true).catch(cause => setError(clientError(cause)));
            }}
            onHistory={() => {
              setTab('history');
              void list(true).catch(cause => setError(clientError(cause)));
            }}
          />
        </ScrollView>
      )}
    </View>
  );
}
