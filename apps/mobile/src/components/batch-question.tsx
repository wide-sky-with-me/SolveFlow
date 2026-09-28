import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from 'react-native';
import type { LocalDiagnostic, LocalRecord } from '@solveflow/contracts/local';
import { terminal, type RunContext, type RunView } from '@solveflow/contracts/http';
import { problemText } from '@solveflow/contracts/agent';
import { clientError, questionConversations } from '@solveflow/client';
import type { Runtime } from '../runtime';
import { mergeRunUpdate } from '../run-updates';
import { Image, SafeAreaView, ScrollView, Text } from '../theme/primitives';
import { QuestionReader } from './question-reader';
import { ImageViewer } from './image-viewer';
import { DiagnosticDetails } from './diagnostic-details';
import { FormulaEditor } from './formula-editor';
import { Button, Notice, s } from './ui';
/** Reuses the exact single-photo thread, follow-up, correction and multi-question renderer. */
export function BatchQuestion({ id, runtime, queueBusy }: { id: string; runtime: Runtime; queueBusy: boolean }) {
  const [record, setRecord] = useState<LocalRecord | null>(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [selected, setSelected] = useState(''); const [view, setView] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LocalDiagnostic[] | null>(null);
  const [correction, setCorrection] = useState<{ run: RunView; number?: number; text: string } | null>(null);
  const alive = useRef(true);
  const refresh = useCallback(async () => { try { const value = await runtime.repository.read(id); for (const run of runtime.engine.actives) if (run.sessionId === id) value.session.runs = value.session.runs.map(item => item.id === run.id ? run : item); if (alive.current) setRecord(value); } catch (cause) { if (alive.current) setError(clientError(cause)); } }, [id, runtime]);
  useEffect(() => { alive.current = true; void refresh(); const off = runtime.engine.subscribe(run => { if (run.sessionId === id) setRecord(current => current ? { ...current, session: { ...current.session, runs: mergeRunUpdate(current.session.runs, run) } } : current); }); return () => { alive.current = false; off(); }; }, [id, runtime, refresh]);
  async function submit(text: string, context?: RunContext) { if (busy || queueBusy) return false; setBusy(true); setError(''); try { await runtime.start(id, text, context); setCorrection(null); return true; } catch (cause) { setError(clientError(cause)); return false; } finally { if (alive.current) setBusy(false); } }
  const threads = questionConversations(record?.session.runs ?? []); const key = threads.some(row => row.key === selected) ? selected : threads[0]?.key ?? '';
  const activeId = runtime.engine.actives.find(run => run.sessionId === id && !terminal(run.status))?.id ?? null;
  if (!record) return error ? <Notice text={error} error /> : <Text style={s.subtitle}>正在读取题目…</Text>;
  return <>
    {error ? <Notice text={error} error /> : null}
    {!threads.length ? <><Image accessibilityLabel="批量待解题原图" source={{ uri: record.image }} resizeMode="contain" style={{ height: 280, width: '100%' }} /><Text style={s.subtitle}>{runtime.batch.ids.includes(id) ? '已保存，正在排队解题并自动核验。' : '题图已保存，点击“继续待解题”开始。'}</Text><Button title="查看原图" secondary onPress={() => setView(true)} /></> :
      <QuestionReader threads={threads} selected={key} onSelect={setSelected} image={record.image} imageSize={record.session.upload} busy={busy || queueBusy} activeId={activeId} available={!!runtime.settings} connection="" onSubmit={submit} onCorrect={(run, number) => { if (run.outcome?.status === 'completed' || run.outcome?.status === 'needs_clarification') setCorrection({ run, text: problemText(run.outcome.candidate.problem).slice(0, 2000), ...(number === undefined ? {} : { number }) }); }} onCancel={() => { if (activeId) void runtime.engine.cancelRun(activeId).catch(cause => setError(clientError(cause))); }} onRefresh={() => void refresh()} onViewOriginal={async () => setView(true)} onAnswerReady={() => {}} onDiagnostics={runId => { void runtime.repository.diagnostics(runId).then(setDiagnostics).catch(cause => setError(clientError(cause))); }} />}
    {view && <ImageViewer uri={record.image} size={record.session.upload} onClose={() => setView(false)} />}
    {diagnostics && <DiagnosticDetails entries={diagnostics} onClose={() => setDiagnostics(null)} />}
    <Modal visible={!!correction} onRequestClose={() => setCorrection(null)}><SafeAreaView style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}><Text style={s.title}>更正题干</Text>{correction && <FormulaEditor value={correction.text} onChange={text => setCorrection(value => value ? { ...value, text } : null)} disabled={busy} />}<Button title="按更正重新解答" disabled={busy || !correction?.text.trim()} onPress={() => { if (correction) void submit('请按更正后的条件重新解答。', { kind: 'correction', sourceRunId: correction.run.id, text: correction.text, ...(correction.number === undefined ? {} : { number: correction.number }) }); }} /><Button title="取消更正" secondary onPress={() => setCorrection(null)} /></ScrollView></SafeAreaView></Modal>
  </>;
}
