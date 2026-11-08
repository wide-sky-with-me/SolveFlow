import { newRequestId } from './request-id.js';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { browserImage, IMAGE_INPUT_ACCEPT } from '@solveflow/image-input';
import { MAX_SOURCE_IMAGE_BYTES } from '@solveflow/image-input/formats';
import { ExamPracticeSnapshotSchema, type ExamPracticeSnapshot } from '@solveflow/contracts/exam-practice';
import { EXAM_LABELS, ExamTypeSchema, type ExamType } from '@solveflow/contracts/exam';
import { Icon } from '@solveflow/web-ui/icons';
import { Select } from '@solveflow/web-ui/select';
import { RichText } from './rich-text.js';
import { api, RequestError } from './api.js';
import { ErrorText, statusLabels } from './components.js';
import { ImageViewer } from './image-viewer.js';

/** A disposable question: no localStorage, IndexedDB, media upload or exam record. */
export function StudentPractice() {
  const picker = useRef<HTMLInputElement>(null), mounted = useRef(true), generation = useRef(0);
  const operation = useRef<AbortController | null>(null), current = useRef<string | null>(null), imageUrl = useRef('');
  const [exam, setExam] = useState<ExamType>('general'), [image, setImage] = useState(''), [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [state, setState] = useState<ExamPracticeSnapshot | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; generation.current++; operation.current?.abort();
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
      if (current.current) void api('/practice/' + current.current + '/cancel', ExamPracticeSnapshotSchema, { method: 'POST', keepalive: true }).catch(() => {});
    };
  }, []);
  function choose(camera: boolean) {
    if (busy || !picker.current) return;
    picker.current.value = '';
    if (camera) picker.current.setAttribute('capture', 'environment'); else picker.current.removeAttribute('capture');
    picker.current.click();
  }
  async function poll(id: string, token: number, signal: AbortSignal) {
    const end = Date.now() + 7 * 60_000;
    let delay = 1000;
    while (!signal.aborted && mounted.current && generation.current === token) {
      if (Date.now() > end) throw new Error('等待答题超时，请重新拍摄。');
      try {
        const next = await api('/practice/' + id, ExamPracticeSnapshotSchema, { signal });
        if (signal.aborted || generation.current !== token) return;
        setState(next); setError(''); delay = 1000;
        if (next.status !== 'running') return;
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof RequestError && [400, 401, 403, 404, 409].includes(error.status)) throw error;
        setError('连接暂时中断，正在获取答题结果…'); delay = Math.min(delay * 2, 5000);
      }
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, delay); signal.addEventListener('abort', done, { once: true });
        if (signal.aborted) done();
      });
    }
  }
  async function picked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || busy) return;
    const token = ++generation.current, controller = new AbortController(); operation.current = controller;
    const id = newRequestId(); current.current = id;
    setBusy(true); setError(''); setState(null); setPreview(false);
    try {
      const source = await browserImage(file, { maxBytes: MAX_SOURCE_IMAGE_BYTES, maxPixels: 20_000_000, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || generation.current !== token) return;
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
      imageUrl.current = URL.createObjectURL(source); setImage(imageUrl.current);
      try {
        const next = await api('/practice', ExamPracticeSnapshotSchema, { method: 'POST', headers: { 'content-type': source.type || 'image/jpeg', 'x-request-id': id, 'x-exam-type': exam }, body: source, signal: controller.signal });
        if (!mounted.current || controller.signal.aborted || generation.current !== token) return;
        setState(next);
        if (next.status === 'running') await poll(id, token, controller.signal);
      } catch (error) {
        // An uncertain POST is never resent. Only read the same in-memory job.
        if (controller.signal.aborted) return;
        if (error instanceof RequestError) throw error;
        await poll(id, token, controller.signal);
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && generation.current === token) {
        setError(error instanceof Error ? error.message : '拍题失败，请重试。');
        void api('/practice/' + id + '/cancel', ExamPracticeSnapshotSchema, { method: 'POST' }).catch(() => {});
      }
    } finally {
      if (mounted.current && generation.current === token) { setBusy(false); current.current = null; operation.current = null; }
    }
  }
  async function stop() {
    const id = current.current; if (!id) return;
    const token = ++generation.current; operation.current?.abort(); operation.current = null; current.current = null;
    setBusy(false); setState(null); setError('');
    try { await api('/practice/' + id + '/cancel', ExamPracticeSnapshotSchema, { method: 'POST' }); }
    catch (error) { if (mounted.current && generation.current === token) setError(error instanceof Error ? error.message : '停止未确认，请稍后检查。'); }
  }
  const outcome = state?.outcome;
  return <section className="student-practice" aria-label="自由拍题">
    <div className="page-title"><h1>拍照解题</h1><Select label="考试类型" value={exam} onChange={value => setExam(ExamTypeSchema.parse(value))} disabled={busy} options={Object.entries(EXAM_LABELS).map(([value, label]) => ({ value, label }))}/></div>
    <section className={'card practice-camera' + (image ? ' has-photo' : '')}><span className="badge">临时答题 · 不保存记录</span>
      {image && <button className="practice-photo" onClick={() => setPreview(true)} aria-label="查看题图"><img src={image} alt="当前题图"/></button>}
      <button className="primary practice-shutter" disabled={busy} onClick={() => choose(true)}><Icon name="camera"/><span>{image ? '拍下一题' : '拍摄题目'}</span></button>
      <button className="quiet" disabled={busy} onClick={() => choose(false)}>从相册选择</button>
      {busy && <div className="practice-progress" role="status"><span className="practice-spinner"/>{state ? statusLabels[state.phase] ?? '正在处理…' : '正在处理题图…'}<button className="quiet" onClick={() => void stop()}>停止</button></div>}
    </section>
    <ErrorText error={error}/>
    {outcome?.status === 'completed' && <section className="card answer-card"><div className="section-head"><h2>答案</h2><span className={'badge ' + (outcome.verified ? 'green' : 'amber')}>{outcome.verified ? 'AI 已核验' : '待核验'}</span></div>{!!outcome.candidate.selectedOptions?.length && <strong className="answer-options">{outcome.candidate.selectedOptions.join('、')}</strong>}<RichText text={outcome.candidate.answer}/><details><summary>题目与解析</summary><RichText text={outcome.candidate.problem.text}/>{outcome.candidate.problem.options?.map(option => <div className="option" key={option.label}><b>{option.label}</b><RichText text={option.text}/></div>)}{outcome.candidate.steps.map((step, index) => <RichText key={index} text={step.explanation}/>)}</details></section>}
    {outcome?.status === 'needs_clarification' && <section className="card"><h2>需要更清晰的题图</h2>{outcome.candidate.clarificationQuestions.map((text, index) => <p key={index}>{text}</p>)}</section>}
    {(outcome?.status === 'failed' || outcome?.status === 'cancelled') && <ErrorText error={outcome.error.message}/>}
    <input hidden ref={picker} type="file" accept={IMAGE_INPUT_ACCEPT} onChange={event => void picked(event)}/>
    {preview && image && <ImageViewer key={image} src={image} local onClose={() => setPreview(false)}/>}
  </section>;
}
