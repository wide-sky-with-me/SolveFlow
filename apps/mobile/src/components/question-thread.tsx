import { MAX_USER_MESSAGE_CHARACTERS } from '@solveflow/contracts/agent';
import { useThreadMemory } from './page-memory';
import { OriginalPhoto } from './original-photo';
import { useQuestionPageReady } from './question-page-ready';
import { MotionModal as Modal } from './motion-modal';
import { Pressable, Text, TextInput, View, SafeAreaView, ScrollView } from '../theme/primitives';
import { useEffect, useRef, useState } from 'react';

import { isAuxiliaryContext, RunContextSchema, terminal, type RunContext, type RunView } from '@solveflow/contracts/http';
import { continuationContext, regenerationContext, REGENERATE_MESSAGE, type QuestionConversation } from '@solveflow/client/learning';
import { AnswerPanel } from './answer-panel';
import { ImageViewer } from './image-viewer';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import { SolveProgress } from './solve-progress';
import { ConversationText } from './conversation-text';
import { Button, Card, Notice, colors, s } from './ui';
export function QuestionThread({ runtime, thread, image, imageSize, busy, conversationBlocked = false, activeId, available, backupAvailable = false, connection, onSubmit, onRetry, retryQueued = false, onCorrect, onCancel, onRefresh, onViewOriginal, onAnswerReady, onDiagnostics, onPageSwipe }: {
  runtime: Runtime;
  conversationBlocked?: boolean;
  backupAvailable?: boolean;
  onRetry?: (run: RunView) => Promise<boolean>;
  retryQueued?: boolean;
  onPageSwipe?: ((direction: number) => Promise<void>) | undefined;
  onDiagnostics: (runId: string) => void;
  onAnswerReady: (key: string) => void;
  thread: QuestionConversation; image: string | null; imageSize: { width: number; height: number }; busy: boolean; activeId: string | null; available: boolean; connection: string;
  onSubmit: (text: string, context?: RunContext) => Promise<boolean>; onCorrect: (run: RunView, number?: number) => void; onCancel: (runId: string) => void; onRefresh: () => void; onViewOriginal: () => Promise<void>;
}) {
  const [{ text, focus, selectedRunId, latestId }, updateMemory] = useThreadMemory(thread.key);
  const setText = (text: string) => updateMemory({ text });
  const setFocus = (focus: { context: RunContext; label: string } | null) => updateMemory({ focus });
  const setSelectedRunId = (selectedRunId: string | null) => updateMemory({ selectedRunId });
  const [historyOpen, setHistoryOpen] = useState(false);
  const input = useRef<TextInput>(null); const fallback = continuationContext(thread); const answerRuns = thread.runs.filter(run => !isAuxiliaryContext(run.context?.kind)); const latest = answerRuns.at(-1); const mainActive = thread.runs.some(run => !terminal(run.status) && !isAuxiliaryContext(run.context?.kind)); const ownAuxiliary = thread.runs.some(run => !terminal(run.status) && isAuxiliaryContext(run.context?.kind)); const disabled = busy || conversationBlocked || !!activeId; const auxiliaryDisabled = busy || mainActive || (!!activeId && !ownAuxiliary); const numberLabel = thread.number === undefined ? '这道题' : `第${thread.number}题`;
  useEffect(() => { if (latestId !== latest?.id) updateMemory({ selectedRunId: null, latestId: latest?.id }); }, [latest?.id, latestId]);
  const displayedRun = answerRuns.find(run => run.id === (selectedRunId ?? latest?.id));
  const primaryId = displayedRun?.imageIds?.[0];
  const switchedImage = !!primaryId && primaryId !== displayedRun?.sessionId;
  const [replacement, setReplacement] = useState<{ id: string; image: string; width: number; height: number } | null>(null);
  const [imageError, setImageError] = useState(''); const [viewReplacement, setViewReplacement] = useState(false);
  useEffect(() => {
    let alive = true; setImageError(''); setViewReplacement(false);
    if (switchedImage && displayedRun) void runtime.repository.read(displayedRun.sessionId).then(record => {
      const item = primaryId === record.session.upload.id ? { ...record.session.upload, image: record.image } : record.materials?.find(item => item.id === primaryId);
      if (!item) throw new Error('本次解答的题图缺失。');
      if (alive) setReplacement(item);
    }).catch(cause => { if (alive) setImageError(clientError(cause)); });
    return () => { alive = false; };
  }, [runtime, primaryId, displayedRun?.sessionId, switchedImage]);
  const answerImage = switchedImage ? replacement?.id === primaryId ? replacement.image : null : image;
  const answerImageSize = switchedImage && replacement?.id === primaryId ? replacement : imageSize;
  const viewImage = async () => { if (switchedImage) setViewReplacement(true); else await onViewOriginal(); };
  const displayedVerification = thread.runs.findLast(run => run.context?.kind === 'verification' && run.context.sourceRunId === displayedRun?.id);
  const displayedOutcome = displayedVerification?.outcome?.status === 'completed' || displayedVerification?.outcome?.status === 'needs_clarification' ? displayedVerification.outcome : displayedRun?.outcome;
  useQuestionPageReady(displayedOutcome?.status === 'completed' || displayedOutcome?.status === 'needs_clarification' ? null : true);
  async function chooseFocus(value: RunContext, label: string, run: RunView) {
    const parsed = RunContextSchema.safeParse(value);
    if (!parsed.success || parsed.data.sourceRunId !== run.id) return;
    if (parsed.data.kind === 'verification') { if (!auxiliaryDisabled && available) await onSubmit('请根据原图核对已有答案和这些步骤。', parsed.data); return; }
    if (disabled || !['step', 'question', 'knowledge'].includes(parsed.data.kind)) return;
    setFocus({ context: parsed.data, label }); if (value.kind === 'knowledge' && !text.trim()) setText(`请解释“${value.name}”的含义、使用条件，以及它在本题中怎么用。`);
    input.current?.focus();
  }
  async function regenerate(useBackup = false) {
    const context = regenerationContext(thread);
    if (!context || disabled || !available) return;
    if (await onSubmit(REGENERATE_MESSAGE, { ...context, ...(useBackup ? { useBackup: true as const } : {}) })) { setHistoryOpen(false); setSelectedRunId(null); setFocus(null); }
  }
  async function requestSteps(run: RunView) {
    if (auxiliaryDisabled || !available || run.outcome?.status !== 'completed') return;
    await onSubmit('请讲解这道题的详细步骤。', { kind: 'explanation', sourceRunId: run.id, ...(run.id === thread.root.id && thread.number !== undefined ? { number: thread.number } : {}) });
  }
  async function requestKnowledge(run: RunView) {
    if (auxiliaryDisabled || !available || run.outcome?.status !== 'completed') return;
    await onSubmit('请给出这道题的知识点。', { kind: 'knowledge-list', sourceRunId: run.id, ...(run.id === thread.root.id && thread.number !== undefined ? { number: thread.number } : {}) });
  }
  async function send() { if (await onSubmit(text, focus?.context ?? fallback)) { setText(''); setFocus(null); setSelectedRunId(null); } }
  return <Card style={{ padding: 0, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent' }} label={thread.number === undefined ? '这道题的持续对话' : `第${thread.number}题解答`}>{thread.number !== undefined && <Text accessibilityRole="header" style={s.label}>{numberLabel}</Text>}
    {!!imageError && <Notice text={imageError} error />}
    {viewReplacement && answerImage && <ImageViewer uri={answerImage} size={answerImageSize} onClose={() => setViewReplacement(false)} />}

    <Modal visible={historyOpen} transparent animationType="fade" onRequestClose={() => setHistoryOpen(false)}>
      <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#17233866' }}><Card style={{ maxHeight: '80%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
        <View style={s.row}><Text accessibilityRole="header" style={[s.label, { flex: 1 }]}>历史解答</Text><Button title="关闭历史解答" compact secondary onPress={() => setHistoryOpen(false)} /></View>
        <ScrollView>{answerRuns.map((item, index) => <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={`第${index + 1}次解答`} accessibilityState={{ checked: item.id === (selectedRunId ?? latest?.id) }} onPress={() => { setSelectedRunId(item.id === latest?.id ? null : item.id); setHistoryOpen(false); }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e7ecf3', gap: 4 }}>
          <Text style={s.label}>第{index + 1}次 · {item.outcome?.status === 'completed' ? '解答' : item.outcome?.status === 'needs_clarification' ? '待补充' : item.outcome ? '未完成' : '进行中'}{item.id === latest?.id ? ' · 最新' : ''}</Text>
          <Text style={s.subtitle} numberOfLines={1}>{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} · {item.message || '拍照解题'}</Text>
        </Pressable>)}</ScrollView>
      </Card></SafeAreaView>
    </Modal>
    {answerRuns.map((run, index) => {
      if (run.id !== (selectedRunId ?? latest?.id)) return null;
      const explanation = thread.runs.findLast(item => item.context?.kind === 'explanation' && item.context.sourceRunId === run.id);
      const knowledgeRun = thread.runs.findLast(item => item.context?.kind === 'knowledge-list' && item.context.sourceRunId === run.id);
      const detailVerification = explanation ? thread.runs.findLast(item => item.context?.kind === 'verification' && item.context.sourceRunId === explanation.id) : undefined;
      const verification = thread.runs.findLast(item => item.context?.kind === 'verification' && item.context.sourceRunId === run.id);
      const outcome = verification?.outcome?.status === 'completed' || verification?.outcome?.status === 'needs_clarification' ? verification.outcome : run.outcome; const isRoot = run.id === thread.root.id; const superseded = answerRuns.slice(index + 1).some(later => later.context?.kind === 'correction' && later.outcome?.status === 'completed');
      return <View key={run.id} style={{ gap: 12, paddingTop: 0 }}>
        {selectedRunId && <Text style={s.subtitle}>第{index + 1}次解答</Text>}
        {run.message && (!isRoot || thread.number === undefined) && run.context?.kind !== 'regenerate' ? <ConversationText label="你的提问" text={run.message} /> : null}
        {answerImage && (!outcome || outcome.status === 'failed' || outcome.status === 'cancelled') && <View style={s.row}><Text style={[s.label, { flex: 1 }]}>题目</Text><OriginalPhoto uri={answerImage} onPress={() => void viewImage()} />{answerRuns.length > 1 && <Button title="历史解答" compact secondary onPress={() => setHistoryOpen(true)} />}</View>}
        {!outcome ? <SolveProgress status={run.status} busy={busy} connection={connection} onCancel={() => onCancel(run.id)} onRefresh={onRefresh} />
          : outcome.status === 'failed' || outcome.status === 'cancelled' ? <><Text accessibilityRole="header" style={s.label}>{outcome.status === 'failed' ? '这次没能完成解题' : '本次解题已取消'}</Text><Notice text={outcome.error.message} error />{outcome.status === 'failed' && <Text selectable style={s.subtitle}>错误代码：{outcome.error.code}</Text>}<Button title="诊断详情" secondary compact onPress={() => onDiagnostics(run.id)} />{run.id === latest?.id && <Button title={retryQueued ? '等待重试' : '重新尝试'} disabled={!available || (onRetry ? busy || !!activeId || retryQueued : disabled)} onPress={() => { void (onRetry ? onRetry(run) : onSubmit(run.message, run.context)); }} />}</>
          : <>
            {(outcome.status === 'needs_clarification' || index > 0) && <Text accessibilityRole="header" style={s.label}>{outcome.status === 'needs_clarification' ? outcome.candidate.refusalReason ? '本次请求无法解答' : '还需要确认一下' : run.context?.kind === 'correction' ? '更正后的解答' : run.context?.kind === 'regenerate' ? '重新解答' : '追问解答'}</Text>}
            {superseded && <Notice text="这是题干更正前的解答，请结合最新更正后的条件判断。" />}
            {run.context?.kind === 'correction' && <ConversationText label="本次更正" text={run.context.text} />}
            <AnswerPanel verificationErrorCode={verification?.outcome?.status === 'failed' || verification?.outcome?.status === 'cancelled' ? verification.outcome.error.code : undefined} verificationPending={!!verification && !verification.outcome || !terminal(run.status) && !!run.outcome} verificationFailed={verification?.outcome?.status === 'failed' || verification?.outcome?.status === 'cancelled'} onVerify={async () => { if (!auxiliaryDisabled && available && verification?.outcome?.status !== 'completed' && verification?.outcome?.status !== 'needs_clarification') await onSubmit('请独立校验这道题的答案。', { kind: 'verification', sourceRunId: run.id, ...(isRoot && thread.number !== undefined ? { number: thread.number } : {}) }); }} showHistory={answerRuns.length > 1} onHistory={async () => setHistoryOpen(true)} explanation={explanation ? { runId: explanation.id, verificationPending: !!detailVerification && !detailVerification.outcome, outcome: detailVerification?.outcome?.status === 'completed' || detailVerification?.outcome?.status === 'needs_clarification' ? detailVerification.outcome : explanation.outcome } : undefined} knowledge={knowledgeRun ? { runId: knowledgeRun.id, outcome: knowledgeRun.outcome } : undefined} onRequestSteps={() => requestSteps(run)} onCancelSteps={async () => { if (explanation && !terminal(explanation.status)) onCancel(explanation.id); }} onRequestKnowledge={() => requestKnowledge(run)} onCancelKnowledge={async () => { if (knowledgeRun && !terminal(knowledgeRun.status)) onCancel(knowledgeRun.id); }} onPageSwipe={onPageSwipe} outcome={outcome} image={answerImage} width={answerImageSize.width} height={answerImageSize.height} runId={run.id} number={isRoot ? thread.number ?? null : null} disabled={auxiliaryDisabled || !available} showRegenerate={run.id === latest?.id && (outcome.status === 'completed' || outcome.status === 'needs_clarification' && !outcome.candidate.refusalReason)} onRegenerate={regenerate}
              onDisplayReady={id => onAnswerReady(`${thread.key}:${id}`)} onViewOriginal={viewImage} onFocus={(context, label) => { const source = thread.runs.find(item => item.id === context.sourceRunId); return source ? chooseFocus(context, label, source) : Promise.resolve(); }} onCorrect={async () => { if (!disabled) onCorrect(run, isRoot ? thread.number : undefined); }} />
            <View testID="answer-task-status" style={[s.row, { justifyContent: 'space-between' }]}>
              {!terminal(run.status) && run.outcome?.status === 'completed' && <Text style={[s.subtitle, { flex: 1, minWidth: 160 }]}>答案已生成 · {run.status === 'revising' ? '正在修正' : '等待或进行独立校验'}</Text>}
              <Pressable accessibilityRole="button" accessibilityLabel="查看解题诊断" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => onDiagnostics(run.id)}>
                <Text style={{ color: outcome.verified ? colors.muted : '#95630d', fontSize: 13, lineHeight: 20 }}>{outcome.verified ? '模型独立校验通过' : outcome.status === 'completed' && outcome.verificationStatus === 'not_requested' ? '未校验' : '尚未验证'}</Text>
              </Pressable>
              {!terminal(run.status) && run.outcome?.status === 'completed' && <Button title="取消任务" compact secondary onPress={() => onCancel(run.id)} />}
            </View>
            {backupAvailable && run.id === latest?.id && outcome.status === 'completed' && outcome.verification?.verdict === 'fail' && <Button title="使用备用模型重新解答" secondary disabled={disabled || !available} onPress={() => void regenerate(true)} />}
          </>}
      </View>;
    })}
    {fallback && <View style={{ gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7ecf3', borderRadius: 16, padding: 16 }}>
      <Text style={s.label}>{latest?.outcome?.status === 'needs_clarification' ? '补充上面的问题' : `继续问${numberLabel}`}</Text>
      {focus && <><ConversationText label="正在追问" text={focus.label} /><Button title="取消指定追问" secondary disabled={disabled} onPress={() => setFocus(null)} /></>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
        {['换一种更简便的解法', '详细解释关键推导步骤', '这道题的核心考点是什么？', '写出规范的答题书写格式'].map(chip => (
          <Pressable
            key={chip}
            accessibilityRole="button"
            accessibilityLabel={`快捷追问：${chip}`}
            onPress={() => { setText(chip); input.current?.focus(); }}
            disabled={disabled}
            style={({ pressed }) => [{
              paddingHorizontal: 12,
              paddingVertical: 6,
              minHeight: 44,
              justifyContent: 'center',
              borderRadius: 14,
              backgroundColor: pressed ? '#deebff' : '#edf3ff',
              borderWidth: 1,
              borderColor: '#e3eaf3',
            }, disabled && { opacity: 0.5 }]}
          >
            <Text style={{ fontSize: 13, color: colors.blue }}>{chip}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <TextInput ref={input} accessibilityLabel={`继续问${numberLabel}`} value={text} onChangeText={setText} multiline maxLength={MAX_USER_MESSAGE_CHARACTERS} editable={!disabled} placeholder="有疑问？在这道题下面继续问" style={s.input} />
      <Button title={thread.number === undefined ? '发送同题追问' : `发送第${thread.number}题追问`} disabled={disabled || !available || !text.trim()} onPress={() => void send()} />
    </View>}
  </Card>;
}
