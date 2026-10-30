import { nativePdfError } from '../local/native-pdf-error';
import { useEffect, useMemo, useRef, useState } from 'react';
import { collectBatchPrint } from '@solveflow/client/local';
import { planBatchPrintCopies, questionsForBatchPrint, questionsForBatchQuestionPrint } from '@solveflow/client/presentation';
import { MAX_BATCH_PRINT_REMARK_CHARACTERS, type BatchPrintSnapshot } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import { ScrollView, Text, TextInput, View } from '../theme/primitives';
import { nativeExportTasks } from '../local/native-export-tasks';
import { inspectExportQuestions } from '../local/export-preflight';
import { editPrintCopyDraft, editPrintCopyRemark, parsePrintCopyDrafts, type PrintCopyState } from '../local/print-copy-drafts';
import { BatchImportDialog } from './batch-import-dialog';
import { Button, Notice, s } from './ui';

export const batchPdfAvailable = true;
export function BatchPdfExport({ runtime, batchId, onClose, onReviewQuestion }: { runtime: Runtime; batchId: string; onClose: () => void; onReviewQuestion?: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<BatchPrintSnapshot | null>(null);
  const [mode, setMode] = useState<'answers' | 'questions'>('answers'); const [markIncorrect, setMarkIncorrect] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [quantities, setQuantities] = useState<PrintCopyState>({ requests: [], drafts: {} });
  const [busy, setBusy] = useState(false); const working = useRef(false); const alive = useRef(true);
  const [progress, setProgress] = useState('读取本批题目'); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const operation = useRef<AbortController | null>(null); const [seed] = useState(() => Math.floor(Math.random() * 0x100000000));
  useEffect(() => {
    alive.current = true; const controller = new AbortController(); operation.current = controller; setProgress('读取本批题目'); setError('');
    void collectBatchPrint(runtime.repository, batchId, controller.signal, (done, total) => { if (!controller.signal.aborted) setProgress(`读取题目 ${done} / ${total}`); })
      .then(value => { if (!controller.signal.aborted) { setSnapshot(value); const count = questionsForBatchQuestionPrint(value).length; setQuantities({ requests: [{ correct: count, incorrect: 0 }], drafts: {} }); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(nativePdfError(cause)); })
      .finally(() => { if (!controller.signal.aborted) setProgress(''); });
    return () => { alive.current = false; controller.abort(); operation.current?.abort(); };
  }, [runtime, batchId, reload]);
  const content = useMemo(() => {
    if (!snapshot) return { problems: [], questions: [], error: '' };
    const problems = questionsForBatchQuestionPrint(snapshot);
    try { return { problems, questions: questionsForBatchPrint(snapshot), error: '' }; }
    catch (cause) { return { problems, questions: [], error: nativePdfError(cause) }; }
  }, [snapshot]);
  const total = content.problems.length; const quantity = parsePrintCopyDrafts(quantities, total, 0);
  const plan = useMemo(() => {
    if (mode === 'questions' || !content.questions.length || quantity.error) return { copies: [], error: '' };
    try { return { copies: planBatchPrintCopies(content.questions, quantity.requests, [], seed), error: '' }; }
    catch (cause) { return { copies: [], error: nativePdfError(cause) }; }
  }, [mode, content.questions, quantities, seed]);
  const issues = inspectExportQuestions(content.problems, mode, 'direct', content.questions);
  const blocked = !snapshot || !total || !!progress || issues.some(issue => issue.blocking) || mode === 'answers' && (!!quantity.error || !!plan.error || !plan.copies.length);
  async function submit() {
    if (working.current || blocked || !snapshot) return;
    working.current = true; setBusy(true); setError(''); const controller = new AbortController(); operation.current = controller;
    try {
      await nativeExportTasks(runtime).submit({ schemaVersion: 1, snapshot, mode, markIncorrect: mode === 'answers' && markIncorrect, copies: mode === 'answers' ? plan.copies : [], exportedAt: new Date().toISOString() }, controller.signal);
      if (alive.current) onClose();
    } catch (cause) { if (alive.current && !controller.signal.aborted) setError(nativePdfError(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  return <BatchImportDialog title="导出 PDF" closeTitle="关闭导出" testID="native-pdf-dialog" avoidKeyboard busy={false} onClose={onClose} footer={<>
    {busy ? <Button title="取消提交" secondary onPress={() => operation.current?.abort()} /> : <Button title={mode === 'answers' && plan.copies.length > 1 ? '生成 PDF 压缩包' : '生成 PDF'} disabled={blocked} onPress={() => void submit()} />}
    <Button title="导出记录" secondary compact onPress={() => { onClose(); nativeExportTasks(runtime).open(); }} />
  </>}>
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
      {(error || content.error && mode === 'answers') && <Notice text={error || content.error} error />}
      {!!progress && <Notice text={progress} />}
      {!snapshot && !progress && <Button title="重新读取" disabled={busy} secondary onPress={() => setReload(value => value + 1)} />}
      {snapshot && <><Text style={s.title}>{snapshot.batch.title}</Text><Text style={s.subtitle}>快速原文 · {total} 题</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['answers', 'questions'] as const).map(value => <Button key={value} title={value === 'answers' ? '题目与作答' : '纯题目'} compact secondary={mode !== value} selected={mode === value} disabled={busy} onPress={() => setMode(value)} />)}</View>
        {mode === 'answers' && <>
          <Text style={s.label}>错题标记</Text><View style={{ flexDirection: 'row', gap: 8 }}><Button title="不标记" compact secondary={markIncorrect} selected={!markIncorrect} disabled={busy} onPress={() => setMarkIncorrect(false)} /><Button title="标记错题" compact secondary={!markIncorrect} selected={markIncorrect} disabled={busy} onPress={() => setMarkIncorrect(true)} /></View>
          <Text style={s.label}>导出份数</Text><TextInput accessibilityLabel="导出份数" keyboardType="number-pad" value={quantities.drafts.count?.text ?? String(quantity.requests.length)} maxLength={8} editable={!busy} onChangeText={text => setQuantities(value => editPrintCopyDraft(value, 'count', text, total, 0))} style={[s.input, { minHeight: 48 }]} />
          {quantity.requests.map((request, index) => <View key={index} style={{ gap: 8 }}><Text style={s.label}>第 {index + 1} 份 · 对 {request.correct} / 错 {request.incorrect}</Text><View style={{ flexDirection: 'row', gap: 8 }}><TextInput accessibilityLabel={`第${index + 1}份错题数`} keyboardType="number-pad" maxLength={8} editable={!busy} value={quantities.drafts.incorrect?.[index]?.text ?? String(request.incorrect)} onChangeText={text => setQuantities(value => editPrintCopyDraft(value, index, text, total, 0))} style={[s.input, { minHeight: 48, width: 80 }]} /><TextInput accessibilityLabel={`第${index + 1}份备注`} placeholder="备注（选填）" editable={!busy} maxLength={MAX_BATCH_PRINT_REMARK_CHARACTERS} value={request.remark ?? ''} onChangeText={text => setQuantities(value => editPrintCopyRemark(value, index, text, total, 0))} style={[s.input, { minHeight: 48, flex: 1, minWidth: 0 }]} /></View></View>)}
          {!!(quantity.error || plan.error) && <Notice text={quantity.error || plan.error} error />}
        </>}
        {!!issues.length && <Button title={`导出检查（${issues.length}）`} compact secondary onPress={() => setShowIssues(value => !value)} />}
        {issues.some(issue => issue.blocking) && <Notice text="部分题目尚无已解析题干，请打开导出检查后补答。" error />}
        {showIssues && <View style={{ gap: 8 }}>{issues.map(issue => <View key={issue.key}><Notice text={`第${issue.ordinal}题：${issue.messages.join('；')}`} error={issue.blocking} />{onReviewQuestion && <Button title={`核对第${issue.ordinal}题`} secondary compact disabled={busy} onPress={() => { onClose(); onReviewQuestion(issue.recordId); }} />}</View>)}</View>}
      </>}
    </ScrollView>
  </BatchImportDialog>;
}
