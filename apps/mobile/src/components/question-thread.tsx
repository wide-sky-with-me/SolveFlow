import { Modal } from 'react-native';
import { Pressable, Text, TextInput, View, SafeAreaView, ScrollView } from '../theme/primitives';
import { useEffect, useRef, useState } from 'react';

import { isAuxiliaryContext, RunContextSchema, terminal, type RunContext, type RunView } from '@solveflow/contracts/http';
import { continuationContext, regenerationContext, REGENERATE_MESSAGE, type QuestionConversation } from '@solveflow/client';
import { AnswerPanel } from './answer-panel';
import { SolveProgress } from './solve-progress';
import { ConversationText } from './conversation-text';
import { Button, Card, Notice, s } from './ui';
export function QuestionThread({ thread, image, imageSize, busy, activeId, available, connection, onSubmit, onCorrect, onCancel, onRefresh, onViewOriginal, onAnswerReady, onDiagnostics, onPageSwipe }: {
  onPageSwipe?: ((direction: number) => Promise<void>) | undefined;
  onDiagnostics: (runId: string) => void;
  onAnswerReady: (key: string) => void;
  thread: QuestionConversation; image: string | null; imageSize: { width: number; height: number }; busy: boolean; activeId: string | null; available: boolean; connection: string;
  onSubmit: (text: string, context?: RunContext) => Promise<boolean>; onCorrect: (run: RunView, number?: number) => void; onCancel: () => void; onRefresh: () => void; onViewOriginal: () => Promise<void>;
}) {
  const [text, setText] = useState(''); const [focus, setFocus] = useState<{ context: RunContext; label: string } | null>(null); const [historyOpen, setHistoryOpen] = useState(false); const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const input = useRef<TextInput>(null); const fallback = continuationContext(thread); const answerRuns = thread.runs.filter(run => !isAuxiliaryContext(run.context?.kind)); const latest = answerRuns.at(-1); const mainActive = thread.runs.some(run => !terminal(run.status) && !isAuxiliaryContext(run.context?.kind)); const ownAuxiliary = thread.runs.some(run => !terminal(run.status) && isAuxiliaryContext(run.context?.kind)); const disabled = busy || !!activeId; const auxiliaryDisabled = busy || mainActive || (!!activeId && !ownAuxiliary); const numberLabel = thread.number === undefined ? '这道题' : `第${thread.number}题`;
  useEffect(() => { setSelectedRunId(null); }, [latest?.id]);
  async function chooseFocus(value: RunContext, label: string, run: RunView) {
    const parsed = RunContextSchema.safeParse(value);
    if (!parsed.success || parsed.data.sourceRunId !== run.id || disabled) return;
    if (parsed.data.kind === 'verification') { if (available) await onSubmit('请独立校验这些步骤。', parsed.data); return; }
    if (!['step', 'question', 'knowledge'].includes(parsed.data.kind)) return;
    setFocus({ context: parsed.data, label }); if (value.kind === 'knowledge' && !text.trim()) setText(`请解释“${value.name}”的含义、使用条件，以及它在本题中怎么用。`);
    input.current?.focus();
  }
  async function regenerate() {
    const context = regenerationContext(thread);
    if (!context || disabled || !available) return;
    if (await onSubmit(REGENERATE_MESSAGE, context)) { setHistoryOpen(false); setSelectedRunId(null); setFocus(null); }
  }
  async function requestSteps(run: RunView) {
    if (disabled || !available || run.outcome?.status !== 'completed') return;
    await onSubmit('请讲解这道题的详细步骤。', { kind: 'explanation', sourceRunId: run.id, ...(run.id === thread.root.id && thread.number !== undefined ? { number: thread.number } : {}) });
  }
  async function requestKnowledge(run: RunView) {
    if (auxiliaryDisabled || !available || run.outcome?.status !== 'completed') return;
    await onSubmit('请给出这道题的知识点。', { kind: 'knowledge-list', sourceRunId: run.id, ...(run.id === thread.root.id && thread.number !== undefined ? { number: thread.number } : {}) });
  }
  async function send() { if (await onSubmit(text, focus?.context ?? fallback)) { setText(''); setFocus(null); setSelectedRunId(null); } }
  return <Card style={{ padding: 0, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent' }} label={thread.number === undefined ? '这道题的持续对话' : `第${thread.number}题解答`}>{thread.number !== undefined && <Text accessibilityRole="header" style={s.label}>{numberLabel}</Text>}
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
        {image && (!outcome || outcome.status === 'failed' || outcome.status === 'cancelled') && <View style={s.row}><Text style={[s.label, { flex: 1 }]}>题目</Text><Button title="查看原图" compact secondary onPress={() => void onViewOriginal()} />{answerRuns.length > 1 && <Button title="历史解答" compact secondary onPress={() => setHistoryOpen(true)} />}</View>}
        {!outcome ? <SolveProgress status={run.status} busy={busy} connection={connection} onCancel={onCancel} onRefresh={onRefresh} />
          : outcome.status === 'failed' || outcome.status === 'cancelled' ? <><Text accessibilityRole="header" style={s.label}>{outcome.status === 'failed' ? '这次没能完成解题' : '本次解题已取消'}</Text><Notice text={outcome.error.message} error />{outcome.status === 'failed' && <Text selectable style={s.subtitle}>错误代码：{outcome.error.code}</Text>}<Button title="诊断详情" secondary compact onPress={() => onDiagnostics(run.id)} />{run.id === latest?.id && <Button title="重新尝试" disabled={disabled || !available} onPress={() => { void onSubmit(run.message, run.context); }} />}</>
          : <>
            {(outcome.status === 'needs_clarification' || index > 0) && <Text accessibilityRole="header" style={s.label}>{outcome.status === 'needs_clarification' ? outcome.candidate.refusalReason ? '本次请求无法解答' : '还需要确认一下' : run.context?.kind === 'correction' ? '更正后的解答' : run.context?.kind === 'regenerate' ? '重新解答' : '追问解答'}</Text>}
            {!outcome.verified && <Pressable accessibilityRole="button" accessibilityLabel="查看解题诊断" onPress={() => onDiagnostics(run.id)}><Text style={{ color: '#95630d', fontSize: 12 }}>{outcome.status === 'completed' && outcome.verificationStatus === 'not_requested' ? '未校验' : '尚未验证'}</Text></Pressable>}
            {superseded && <Notice text="这是题干更正前的解答，请结合最新更正后的条件判断。" />}
            {run.context?.kind === 'correction' && <ConversationText label="本次更正" text={run.context.text} />}
            <AnswerPanel verificationPending={!!verification && !verification.outcome} verificationFailed={verification?.outcome?.status === 'failed' || verification?.outcome?.status === 'cancelled'} onVerify={async () => { if (!auxiliaryDisabled && available && verification?.outcome?.status !== 'completed' && verification?.outcome?.status !== 'needs_clarification') await onSubmit('请独立校验这道题的答案。', { kind: 'verification', sourceRunId: run.id, ...(isRoot && thread.number !== undefined ? { number: thread.number } : {}) }); }} showHistory={answerRuns.length > 1} onHistory={async () => setHistoryOpen(true)} explanation={explanation ? { runId: explanation.id, verificationPending: !!detailVerification && !detailVerification.outcome, outcome: detailVerification?.outcome?.status === 'completed' || detailVerification?.outcome?.status === 'needs_clarification' ? detailVerification.outcome : explanation.outcome } : undefined} knowledge={knowledgeRun ? { runId: knowledgeRun.id, outcome: knowledgeRun.outcome } : undefined} onRequestSteps={() => requestSteps(run)} onCancelSteps={async () => { onCancel(); }} onRequestKnowledge={() => requestKnowledge(run)} onCancelKnowledge={async () => { onCancel(); }} onPageSwipe={onPageSwipe} outcome={outcome} image={image} width={imageSize.width} height={imageSize.height} runId={run.id} number={isRoot ? thread.number ?? null : null} disabled={auxiliaryDisabled || !available} showRegenerate={run.id === latest?.id && (outcome.status === 'completed' || outcome.status === 'needs_clarification' && !outcome.candidate.refusalReason)} onRegenerate={regenerate}
              onDisplayReady={id => onAnswerReady(`${thread.key}:${id}`)} onViewOriginal={onViewOriginal} onFocus={(context, label) => { const source = thread.runs.find(item => item.id === context.sourceRunId); return source ? chooseFocus(context, label, source) : Promise.resolve(); }} onCorrect={async () => { if (!disabled) onCorrect(run, isRoot ? thread.number : undefined); }} />
            {outcome.verified && <Pressable accessibilityRole="button" accessibilityLabel="查看解题诊断" onPress={() => onDiagnostics(run.id)}><Text style={{ color: '#738276', fontSize: 11 }}>模型独立校验通过</Text></Pressable>}
          </>}
      </View>;
    })}
    {fallback && <View style={{ gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7ecf3', borderRadius: 16, padding: 16 }}>
      <Text style={s.label}>{latest?.outcome?.status === 'needs_clarification' ? '补充上面的问题' : `继续问${numberLabel}`}</Text>
      {focus && <><ConversationText label="正在追问" text={focus.label} /><Button title="取消指定追问" secondary disabled={disabled} onPress={() => setFocus(null)} /></>}
      <TextInput ref={input} accessibilityLabel={`继续问${numberLabel}`} value={text} onChangeText={setText} multiline maxLength={2000} editable={!disabled} placeholder="有疑问？在这道题下面继续问" style={s.input} />
      <Button title={thread.number === undefined ? '发送同题追问' : `发送第${thread.number}题追问`} disabled={disabled || !available || !text.trim()} onPress={() => void send()} />
    </View>}
  </Card>;
}
