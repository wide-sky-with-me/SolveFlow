import { stableDocumentHeight } from '../dom/document-height';
import { AppState, useWindowDimensions } from 'react-native';
import { startDocumentDeadline } from './document-deadline';
import { themeColors } from '../theme/palette';
import { useTheme } from '../theme/provider';
import { Text, View } from '../theme/primitives';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { QuestionPageActivity } from './question-page-activity';

import { encodeAnswerDocument, verificationFeedback, type AnswerDocumentPayload } from '@solveflow/client';
import type { RunContext } from '@solveflow/contracts/http';
import AnswerDocument from '../dom/answer-document';
import { documentProps } from '../document-props';
import { Button, Card, Notice, s } from './ui';
type Props = Omit<AnswerDocumentPayload, 'schemaVersion'> & {
  onVerify?: (() => Promise<void>) | undefined;
  onHistory?: (() => Promise<void>) | undefined;
  onRequestSteps?: (() => Promise<void>) | undefined; onCancelSteps?: (() => Promise<void>) | undefined;
  onRequestKnowledge?: (() => Promise<void>) | undefined; onCancelKnowledge?: (() => Promise<void>) | undefined;
  onPageSwipe?: ((direction: number) => Promise<void>) | undefined;
  onRegenerate: () => Promise<void>;
  onDisplayReady: (runId: string) => void;
  onFocus: (context: RunContext, label: string) => Promise<void>;
  onCorrect: () => Promise<void>;
  onViewOriginal: () => Promise<void>;
};
/** Loading the persisted answer never submits another model request. */
export function AnswerPanel({ outcome, image, width, height, runId, number, disabled, showRegenerate, onRegenerate, onFocus, onCorrect, onViewOriginal, onDisplayReady, onPageSwipe, explanation, knowledge, onRequestSteps, onCancelSteps, onRequestKnowledge, onCancelKnowledge, showHistory, onHistory, verificationPending, verificationFailed, verificationErrorCode, onVerify }: Props) {
  const { scheme } = useTheme(); const { fontScale } = useWindowDimensions();
  const visible = useContext(QuestionPageActivity);
  const [contentHeight, setContentHeight] = useState(80);
  const onHeight = useCallback(async (value: number) => { setContentHeight(previous => stableDocumentHeight(previous, value)); }, []);
  const payload = useMemo(() => encodeAnswerDocument({ schemaVersion: 1, outcome, image, width, height, runId, number, disabled, showRegenerate, showHistory, verificationPending, verificationFailed, verificationErrorCode, ...(explanation ? { explanation } : {}), ...(knowledge ? { knowledge } : {}) }), [outcome, image, width, height, runId, number, disabled, showRegenerate, showHistory, verificationPending, verificationFailed, verificationErrorCode, explanation, knowledge]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [stepsOpen, setStepsOpen] = useState(false);
  useEffect(() => {
    if (state !== 'loading') return;
    return startDocumentDeadline(() => setState('failed'), {
      isActive: () => AppState.currentState === 'active',
      isVisible: () => visible,
      subscribe: listener => { const subscription = AppState.addEventListener('change', listener); return () => subscription.remove(); },
    });
  }, [state, attempt, visible]);
  useEffect(() => { if (state !== 'loading') onDisplayReady(runId); }, [state, runId, onDisplayReady]);
  const ready = useCallback(async () => { setState(value => value === 'failed' ? value : 'ready'); }, []);
  const failed = useCallback(() => setState('failed'), []);
  const fallbackSteps = outcome.status === 'completed' && !outcome.candidate.steps.length && explanation?.outcome?.status === 'completed' ? explanation.outcome.candidate.steps : (outcome.status === 'completed' || outcome.status === 'needs_clarification') ? outcome.candidate.steps : [];
  const stepsPending = !!explanation && explanation.outcome === null;
  const dom = useMemo(() => ({ ...documentProps, matchContents: false, textZoom: Math.round(fontScale * 100), containerStyle: { flex: 0, width: '100%' as const, height: contentHeight }, style: { backgroundColor: themeColors[scheme].background }, onError: failed, onHttpError: failed, onRenderProcessGone: failed, onContentProcessDidTerminate: failed }), [failed, scheme, contentHeight, fontScale]);
  const fallbackProblem = outcome.status === 'completed' || outcome.status === 'needs_clarification' ? outcome.candidate.problem : undefined;
  const fallbackSelection = outcome.status === 'completed' ? outcome.candidate.selectedOptions : undefined;
  const feedback = verificationFeedback(outcome, verificationErrorCode);
  if (state === 'failed') return <View style={{ gap: 12 }}>
    <Notice text="图文解答加载失败，已保留结果。下方先显示文字内容，公式和图示可尝试重新加载。" error />
    <Button title="重新加载解答" secondary onPress={() => { setAttempt(value => value + 1); setState('loading'); }} />
    {(outcome.status === 'completed' || outcome.status === 'needs_clarification') && <>
      <Card style={{ borderRadius: 16 }}><View style={s.row}><Text style={[s.label, { flex: 1 }]}>题目</Text>{showRegenerate && <Button title="重新解答" icon="refresh" compact secondary disabled={disabled} onPress={() => void onRegenerate()} />}{image && <Button title="查看原图" compact secondary onPress={() => void onViewOriginal()} />}{showHistory && <Button title="历史解答" compact secondary onPress={() => void onHistory?.()} />}</View><Text selectable style={s.subtitle}>{fallbackProblem?.text}</Text>{fallbackProblem?.options?.map(option => <View key={option.label} style={{ flexDirection: 'row', gap: 12, padding: 12 }}><Text style={s.label}>{option.label}</Text><Text selectable style={[s.subtitle, { flex: 1 }]}>{option.text}</Text></View>)}</Card>
      {!!fallbackProblem?.uncertainties.length && <Notice text={`识别待确认：${fallbackProblem.uncertainties.join('；')}。请查看原图，并用更正题干补全条件。`} />}
      {feedback && <Card><Text style={s.label}>{feedback.title}</Text><Text selectable>{feedback.reason}</Text>{feedback.issues.map((issue, index) => <Text selectable key={index}>{issue.label}：{issue.message}</Text>)}<Text selectable>{feedback.next}</Text></Card>}
      <Button title="识别有误？更正题干" secondary disabled={disabled} onPress={() => void onCorrect()} />
      {outcome.status === 'completed' ? <Card style={{ borderRadius: 16 }}><View style={s.row}><Text style={[s.label, { flex: 1 }]}>{fallbackSelection ? `答案：${fallbackSelection.join('、')}` : '答案'}</Text><Button title={verificationPending ? '校验中' : outcome.verified ? '校验通过' : outcome.verification ? outcome.verification.verdict === 'fail' ? '发现问题' : '无法确认' : verificationFailed ? '重试校验' : '校验'} compact secondary disabled={disabled || verificationPending || outcome.verified || !!outcome.verification} onPress={() => void onVerify?.()} /></View><Text selectable>{outcome.candidate.answer}</Text></Card> : outcome.candidate.clarificationQuestions.map(question => <Text selectable key={question}>{question}</Text>)}
      {(!!fallbackSteps.length || outcome.status === 'completed') && <Card style={{ borderRadius: 16 }}><Button title={stepsOpen ? "收起详细步骤" : "展开详细步骤"} secondary onPress={() => { setStepsOpen(value => !value); if (!stepsOpen && !fallbackSteps.length && !explanation && !disabled) void onRequestSteps?.(); }} />
      {stepsOpen && <>{stepsPending ? <><Text>正在整理步骤…</Text><Button title="取消" compact secondary onPress={() => void onCancelSteps?.()} /></> : !fallbackSteps.length ? <Button title={explanation ? '重新生成步骤' : '查看详细步骤'} disabled={disabled} secondary onPress={() => void onRequestSteps?.()} /> : fallbackSteps.map((step, index) => <View key={step.id} style={{ gap: 4 }}><Text style={s.label}>{index + 1}. {step.title}</Text><Text selectable>{step.explanation}</Text>{step.latex ? <Text selectable>{step.latex}</Text> : null}</View>)}</>}</Card>}
      {!!outcome.candidate.knowledgePoints.length && <Card style={{ borderRadius: 16 }}><Text style={s.label}>知识点</Text><Text selectable>{outcome.candidate.knowledgePoints.join('、')}</Text></Card>}
    </>}
  </View>;
  return <View style={{ gap: 8 }}>
    {state === 'loading' && <Text accessibilityLiveRegion="polite" style={s.subtitle}>正在显示解答…</Text>}
    <AnswerDocument onVerify={onVerify} onHistory={onHistory} onHeight={onHeight} onRequestSteps={onRequestSteps} onCancelSteps={onCancelSteps} onRequestKnowledge={onRequestKnowledge} onCancelKnowledge={onCancelKnowledge} onPageSwipe={onPageSwipe} theme={scheme} key={attempt} dom={dom} payload={payload} onFocus={onFocus} onCorrect={onCorrect} onReady={ready} onViewOriginal={onViewOriginal} onRegenerate={onRegenerate} />
  </View>;
}
