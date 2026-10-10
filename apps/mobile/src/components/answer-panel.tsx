import { z } from 'zod';
import type { DOMProps } from 'expo/dom';
import { waitForDocumentPaint } from './document-paint';
import { PageMemory } from './page-memory';
import type { ReadingState } from '../dom/reading-state';
import { useImageShare } from './use-image-share';
import { OriginalPhoto } from './original-photo';
import { stableDocumentHeight } from '../dom/document-height';
import { AppState, Platform, useWindowDimensions } from 'react-native';
import { startDocumentDeadline } from './document-deadline';
import { themeColors } from '../theme/palette';
import { useTheme } from '../theme/provider';
import { Text, View } from '../theme/primitives';
import { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useDocumentAction } from './use-document-action';
import { QuestionPageRequested, useQuestionPageReady } from './question-page-ready';

import { encodeAnswerDocument, verificationFeedback, type AnswerDocumentPayload } from '@solveflow/client/presentation';
import type { RunContext } from '@solveflow/contracts/http';
import AnswerDocument from '../dom/answer-document';
const MemoAnswerDocument = memo(AnswerDocument);
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
export const answerHeightCache = new Map<string, number>();

export function estimateAnswerHeight(payload: {
  outcome: AnswerDocumentPayload['outcome'];
  image?: string | null;
  width?: number;
  height?: number;
  explanation?: unknown;
  knowledge?: unknown;
}): number {
  let est = 160;
  if (payload.image) {
    if (payload.width && payload.height && payload.width > 0) {
      const imgH = Math.round((360 / payload.width) * payload.height);
      est += Math.min(300, Math.max(140, imgH)) + 24;
    } else {
      est += 220;
    }
  }
  if (payload.outcome.status === 'completed' || payload.outcome.status === 'needs_clarification') {
    const textLen = payload.outcome.candidate.problem.text?.length ?? 0;
    est += Math.ceil(textLen / 25) * 24 + 20;
    const opts = payload.outcome.candidate.problem.options?.length ?? 0;
    if (opts > 0) est += opts * 40;
    est += 140;
    if (payload.outcome.candidate.steps?.length) {
      est += payload.outcome.candidate.steps.length * 80;
    }
    if (payload.outcome.candidate.knowledgePoints?.length) {
      est += 90;
    }
  }
  return Math.min(2400, Math.max(480, est));
}

/** Loading the persisted answer never submits another model request. */
export function AnswerPanel({ outcome, image, width, height, runId, number, disabled, showRegenerate, onRegenerate, onFocus, onCorrect, onViewOriginal, onDisplayReady, onPageSwipe, explanation, knowledge, onRequestSteps, onCancelSteps, onRequestKnowledge, onCancelKnowledge, showHistory, onHistory, verificationPending, verificationFailed, verificationErrorCode, onVerify }: Props) {
  const { scheme } = useTheme(); const { fontScale } = useWindowDimensions();
  const { share, error: shareError } = useImageShare(image);
  const memory = useContext(PageMemory);
  const readingKey = `${runId}:${number ?? 'single'}`;
  const onReadingState = useCallback(async (value: ReadingState) => {
    // DOM messages cannot retain arbitrary payloads or photos in reader memory.
    if (value && Object.keys(value).length <= 100 && Object.entries(value).every(([key, open]) => key.length <= 200 && typeof open === 'boolean')) memory?.documents.set(readingKey, value);
  }, [memory, readingKey]);
  const requested = useContext(QuestionPageRequested);
  const [measured, setMeasured] = useState(false);
  const [painted, setPainted] = useState(false);
  const [nativeTag, setNativeTag] = useState<number | null>(null);
  const onLoadEnd = useCallback<NonNullable<DOMProps['onLoadEnd']>>(event => {
    const parsed = z.object({ target: z.number().int().positive() }).safeParse(event.nativeEvent);
    if (parsed.success) setNativeTag(parsed.data.target);
  }, []);
  const [contentHeight, setContentHeight] = useState(() => (runId ? answerHeightCache.get(runId) : undefined) ?? estimateAnswerHeight({ outcome, image, width, height, explanation, knowledge }));
  useEffect(() => {
    if (runId && answerHeightCache.has(runId)) {
      setContentHeight(answerHeightCache.get(runId)!);
    }
  }, [runId]);
  const onHeight = useCallback(async (value: number) => {
    setMeasured(true);
    setContentHeight(previous => {
      const next = stableDocumentHeight(previous, value);
      if (runId) answerHeightCache.set(runId, next);
      return next;
    });
  }, [runId]);
  const explanationId = explanation?.runId; const explanationOutcome = explanation?.outcome; const explanationPending = explanation?.verificationPending;
  const knowledgeId = knowledge?.runId; const knowledgeOutcome = knowledge?.outcome;
  const payload = useMemo(() => encodeAnswerDocument({ schemaVersion: 1, outcome, image, width, height, runId, number, disabled, showRegenerate, showHistory, verificationPending, verificationFailed, verificationErrorCode,
    ...(explanationId && explanationOutcome !== undefined ? { explanation: { runId: explanationId, outcome: explanationOutcome, ...(explanationPending === undefined ? {} : { verificationPending: explanationPending }) } } : {}),
    ...(knowledgeId && knowledgeOutcome !== undefined ? { knowledge: { runId: knowledgeId, outcome: knowledgeOutcome } } : {}),
  }), [outcome, image, width, height, runId, number, disabled, showRegenerate, showHistory, verificationPending, verificationFailed, verificationErrorCode, explanationId, explanationOutcome, explanationPending, knowledgeId, knowledgeOutcome]);
  const verifyAction = useDocumentAction(onVerify); const historyAction = useDocumentAction(onHistory);
  const stepsAction = useDocumentAction(onRequestSteps); const cancelStepsAction = useDocumentAction(onCancelSteps);
  const knowledgeAction = useDocumentAction(onRequestKnowledge); const cancelKnowledgeAction = useDocumentAction(onCancelKnowledge);
  const swipeAction = useDocumentAction(onPageSwipe); const focusAction = useDocumentAction(onFocus);
  const correctAction = useDocumentAction(onCorrect); const originalAction = useDocumentAction(onViewOriginal);
  const regenerateAction = useDocumentAction(onRegenerate); const shareAction = useDocumentAction(share);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [stepsOpen, setStepsOpen] = useState(false);
  const shouldPaint = Platform.OS !== 'android' || requested;
  useEffect(() => {
    if (!shouldPaint) { setPainted(false); return; }
    if (state !== 'ready' || !measured) return;
    return waitForDocumentPaint(nativeTag, () => setPainted(true), () => setState('failed'));
  }, [state, measured, attempt, nativeTag, shouldPaint]);
  useQuestionPageReady(state === 'failed' || (state === 'ready' && painted));
  useEffect(() => {
    if (state === 'failed' || painted) return;
    return startDocumentDeadline(() => setState('failed'), {
      isActive: () => AppState.currentState === 'active',
      isVisible: () => requested,
      subscribe: listener => { const subscription = AppState.addEventListener('change', listener); return () => subscription.remove(); },
    });
  }, [state, painted, attempt, requested]);
  useEffect(() => { if (state !== 'loading') onDisplayReady(runId); }, [state, runId, onDisplayReady]);
  const ready = useCallback(async () => { setState(value => value === 'failed' ? value : 'ready'); }, []);
  const failed = useCallback(() => setState('failed'), []);
  const fallbackSteps = outcome.status === 'completed' && !outcome.candidate.steps.length && explanation?.outcome?.status === 'completed' ? explanation.outcome.candidate.steps : (outcome.status === 'completed' || outcome.status === 'needs_clarification') ? outcome.candidate.steps : [];
  const stepsPending = !!explanation && explanation.outcome === null;
  const dom = useMemo(() => ({ ...documentProps, matchContents: false, textZoom: Math.round(fontScale * 100), containerStyle: { flex: 0, width: '100%' as const, height: contentHeight }, style: { backgroundColor: themeColors[scheme].background }, onLoadEnd, onError: failed, onHttpError: failed, onRenderProcessGone: failed, onContentProcessDidTerminate: failed }), [failed, scheme, contentHeight, fontScale, onLoadEnd]);
  const fallbackProblem = outcome.status === 'completed' || outcome.status === 'needs_clarification' ? outcome.candidate.problem : undefined;
  const fallbackSelection = outcome.status === 'completed' ? outcome.candidate.selectedOptions : undefined;
  const feedback = verificationFeedback(outcome, verificationErrorCode);
  if (state === 'failed') return <View style={{ gap: 12 }}>
    <Notice text="图文解答加载失败，已保留结果。下方先显示文字内容，公式和图示可尝试重新加载。" error />
    <Button title="重新加载解答" secondary onPress={() => { setAttempt(value => value + 1); setMeasured(false); setPainted(false); setNativeTag(null); setState('loading'); }} />
    {(outcome.status === 'completed' || outcome.status === 'needs_clarification') && <>
      <Card style={{ borderRadius: 16 }}><View style={s.row}><Text style={[s.label, { flex: 1 }]}>题目</Text>{showRegenerate && <Button title="重新解答" icon="refresh" compact secondary disabled={disabled} onPress={() => void onRegenerate()} />}{showHistory && <Button title="历史解答" compact secondary onPress={() => void onHistory?.()} />}</View>{image && <OriginalPhoto uri={image} onPress={() => void onViewOriginal()} />}<Text selectable style={s.subtitle}>{fallbackProblem?.text}</Text>{fallbackProblem?.options?.map(option => <View key={option.label} style={{ flexDirection: 'row', gap: 12, padding: 12 }}><Text style={s.label}>{option.label}</Text><Text selectable style={[s.subtitle, { flex: 1 }]}>{option.text}</Text></View>)}</Card>
      {!!fallbackProblem?.uncertainties.length && <Notice text={`识别待确认：${fallbackProblem.uncertainties.join('；')}。请查看原图，并用更正题干补全条件。`} />}
      {feedback && <Card><Text style={s.label}>{feedback.title}</Text><Text selectable>{feedback.reason}</Text>{feedback.issues.map((issue, index) => <Text selectable key={index}>{issue.label}：{issue.message}</Text>)}<Text selectable>{feedback.next}</Text></Card>}
      <Button title="识别有误？更正题干" secondary disabled={disabled} onPress={() => void onCorrect()} />
      {outcome.status === 'completed' ? <Card style={{ borderRadius: 16 }}><View style={s.row}><Text style={[s.label, { flex: 1 }]}>{fallbackSelection ? `答案：${fallbackSelection.join('、')}` : '答案'}</Text><Button title={verificationPending ? '校验中' : outcome.verified ? '校验通过' : outcome.verification ? outcome.verification.verdict === 'fail' ? '发现问题' : '无法确认' : verificationFailed ? '重试校验' : '校验'} compact secondary disabled={disabled || verificationPending || outcome.verified || !!outcome.verification} onPress={() => void onVerify?.()} /></View><Text selectable>{outcome.candidate.answer}</Text></Card> : outcome.candidate.clarificationQuestions.map(question => <Text selectable key={question}>{question}</Text>)}
      {(!!fallbackSteps.length || outcome.status === 'completed') && <Card style={{ borderRadius: 16 }}><Button title={stepsOpen ? "收起详细步骤" : "展开详细步骤"} secondary onPress={() => { setStepsOpen(value => !value); if (!stepsOpen && !fallbackSteps.length && !explanation && !disabled) void onRequestSteps?.(); }} />
      {stepsOpen && <>{stepsPending ? <><Text>正在整理步骤…</Text><Button title="取消" compact secondary onPress={() => void onCancelSteps?.()} /></> : !fallbackSteps.length ? <Button title={explanation ? '重新生成步骤' : '查看详细步骤'} disabled={disabled} secondary onPress={() => void onRequestSteps?.()} /> : fallbackSteps.map((step, index) => <View key={step.id} style={{ gap: 4 }}><Text style={s.label}>{index + 1}. {step.title}</Text><Text selectable>{step.explanation}</Text>{step.latex ? <Text selectable>{step.latex}</Text> : null}</View>)}</>}</Card>}
      {!!outcome.candidate.knowledgePoints.length && <Card style={{ borderRadius: 16 }}><Text style={s.label}>知识点</Text><Text selectable>{outcome.candidate.knowledgePoints.join('、')}</Text></Card>}
    </>}
  </View>;
  return <View style={{ position: 'relative' }}>
    {!!shareError && <Notice text={shareError} error />}
    <MemoAnswerDocument initialReadingState={memory?.documents.get(readingKey)} onReadingState={onReadingState} onShareOriginal={shareAction} onVerify={verifyAction} onHistory={historyAction} onHeight={onHeight} onRequestSteps={stepsAction} onCancelSteps={cancelStepsAction} onRequestKnowledge={knowledgeAction} onCancelKnowledge={cancelKnowledgeAction} onPageSwipe={swipeAction} theme={scheme} key={attempt} dom={dom} payload={payload} onFocus={focusAction} onCorrect={correctAction} onReady={ready} onViewOriginal={originalAction} onRegenerate={regenerateAction} />
  </View>;
}
