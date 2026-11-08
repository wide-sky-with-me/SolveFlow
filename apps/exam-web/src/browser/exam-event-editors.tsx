import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExamTemplatePageSchema } from '@solveflow/contracts/managed-exam';
import { EXAM_LABELS, ExamTypeSchema } from '@solveflow/contracts/exam';
import type { ExamEvent, ExamConcrete } from '@solveflow/contracts/exam-events';
import { Select } from '@solveflow/web-ui/select';
import { api, idResponse, post } from './api.js';
import { Dialog, ErrorText } from './components.js';
import { RemoteSelect } from './remote-select.js';
import { AllocationFields, allocationInput, allocationToken } from './allocation-fields.js';
import { editedExamTime, localExamTime as localTime } from './exam-presentation.js';

export function EventEditor({ initial, template = '', onClose, onSaved }: {
    initial: ExamEvent | null;
    template?: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [templateId, setTemplate] = useState(initial?.templateId ?? template),
        [exam, setExam] = useState<string>(initial?.exam ?? ''),
        [title, setTitle] = useState(initial?.title ?? ''),
        [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const token = useRef<{ key: string; id: string } | null>(null),
        controller = useRef<AbortController | null>(null);

    useEffect(() => () => controller.current?.abort(), []);

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const request = new AbortController();
        controller.current = request;
        setBusy(true);
        setError('');
        try {
            const payload = {
                title,
                templateId,
                ...initial ? { expectedVersion: initial.version } : {},
            };
            await api('/admin/exam-events' + (initial ? '/' + initial.id + '/edit' : ''), idResponse, {
                ...post({ requestId: allocationToken(token, payload), ...payload }),
                signal: request.signal,
            });
            if (!request.signal.aborted) onSaved();
        } catch (error) {
            if (!request.signal.aborted) {
                setError(error instanceof Error ? error.message : '保存场次失败。');
            }
        } finally {
            if (!request.signal.aborted) setBusy(false);
        }
    }

    return <Dialog
        title={initial ? '编辑场次' : '新建场次'}
        notice={error ? <ErrorText error={error}/> : null}
        onClose={() => { if (!busy) onClose(); }}
    >
        <form onSubmit={event => void save(event)}>
            <label>
                场次名称
                <input required maxLength={120} value={title} disabled={busy}
                    onChange={event => setTitle(event.target.value)}/>
            </label>
            <Select
                label="考试类型"
                value={exam}
                disabled={busy || !!initial?.hasStarted}
                onChange={value => { setExam(value); setTemplate(''); }}
                options={[
                    { value: '', label: '全部类型' },
                    ...ExamTypeSchema.options.map(value => ({ value, label: EXAM_LABELS[value] })),
                ]}
            />
            <RemoteSelect
                key={exam}
                label="考试模板"
                schema={ExamTemplatePageSchema}
                endpoint="/admin/templates/page"
                params={{ exam: exam || undefined }}
                value={templateId}
                onChange={setTemplate}
                onSelect={item => { if (item && !exam) setExam(item.exam); }}
                required
                disabled={busy || !!initial?.hasStarted}
            />
            {initial?.hasStarted && <p className="muted">已有学生参加，模板已固定；场次名称仍可修改。</p>}
            <div className="dialog-footer">
                <button type="button" disabled={busy} onClick={onClose}>取消</button>
                <button className="primary" disabled={busy || !templateId} type="submit">
                    {busy ? '保存中…' : '保存场次'}
                </button>
            </div>
        </form>
    </Dialog>;
}

export function ConcreteEditor({ parent, initial, onClose, onSaved }: {
    parent: ExamEvent;
    initial: ExamConcrete | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [timeMode, setTimeMode] = useState(initial?.closesAt ? 'limited' : 'unlimited'),
        [busy, setBusy] = useState(false),
        [ready, setReady] = useState(true),
        [error, setError] = useState('');
    const token = useRef<{ key: string; id: string } | null>(null),
        start = useRef(new Date().toISOString()),
        controller = useRef<AbortController | null>(null);

    useEffect(() => () => controller.current?.abort(), []);

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget),
            text = (name: string) => String(form.get(name) ?? '');
        const request = new AbortController();
        controller.current = request;
        setBusy(true);
        setError('');
        try {
            const payload = {
                title: text('title'),
                opensAt: initial?.started
                    ? initial.opensAt
                    : timeMode === 'limited'
                        ? editedExamTime(text('opensAt'), initial?.opensAt)
                        : initial?.opensAt ?? start.current,
                closesAt: initial?.started
                    ? initial.closesAt
                    : timeMode === 'limited'
                        ? editedExamTime(text('closesAt'), initial?.closesAt)
                        : null,
                ...initial ? { expectedVersion: initial.version } : allocationInput(form),
            };
            await api('/admin/exam-events/' + parent.id + '/exams' + (initial ? '/' + initial.id + '/edit' : ''), idResponse, {
                ...post({ requestId: allocationToken(token, payload), ...payload }),
                signal: request.signal,
            });
            if (!request.signal.aborted) onSaved();
        } catch (error) {
            if (!request.signal.aborted) {
                setError(error instanceof Error ? error.message : '保存考试失败。');
            }
        } finally {
            if (!request.signal.aborted) setBusy(false);
        }
    }

    return <Dialog
        title={initial ? '编辑具体考试' : '新建具体考试'}
        notice={error ? <ErrorText error={error}/> : null}
        onClose={() => { if (!busy) onClose(); }}
    >
        <form onSubmit={event => void save(event)}>
            <p className="muted">{parent.title} · {EXAM_LABELS[parent.exam]} · {parent.templateTitle}</p>
            <label>
                考试名称
                <input name="title" defaultValue={initial?.title ?? ''} required maxLength={120} disabled={busy}/>
            </label>
            <Select
                label="考试时间"
                value={timeMode}
                onChange={setTimeMode}
                disabled={busy || !!initial?.started}
                options={[
                    { value: 'unlimited', label: '不限时间' },
                    { value: 'limited', label: '限定时间' },
                ]}
            />
            {timeMode === 'limited' && <div className="sitting-time-fields">
                <label>
                    开始时间
                    <input type="datetime-local" name="opensAt" required
                        defaultValue={localTime(initial?.opensAt ?? new Date().toISOString())}
                        disabled={busy || !!initial?.started}/>
                </label>
                <label>
                    结束时间
                    <input type="datetime-local" name="closesAt" required
                        defaultValue={initial?.closesAt ? localTime(initial.closesAt) : ''}
                        disabled={busy || !!initial?.started}/>
                </label>
            </div>}
            {initial?.started && <p className="muted">已有学生参加，时间已固定；考试名称仍可修改。</p>}
            {!initial && <AllocationFields templateId={parent.templateId} disabled={busy} onReady={setReady}/>}
            <div className="dialog-footer">
                <button type="button" disabled={busy} onClick={onClose}>取消</button>
                <button className="primary" type="submit" disabled={busy || !ready}>
                    {busy ? '保存中…' : '保存考试'}
                </button>
            </div>
        </form>
    </Dialog>;
}
