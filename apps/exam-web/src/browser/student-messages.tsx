import { useState } from 'react';
import type { ExamTeacherMessage } from '@solveflow/contracts/managed-exam';
import { z } from 'zod';
import { Icon } from '@solveflow/web-ui/icons';
import { api } from './api.js';
import { Dialog, ErrorText, QuestionNotices } from './components.js';
export function StudentMessages({ messages, onQuestion, onRefresh }: {
    messages: ExamTeacherMessage[];
    onQuestion: (message: ExamTeacherMessage) => void;
    onRefresh: () => Promise<unknown>;
}) {
    const [selected, setSelected] = useState<ExamTeacherMessage | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function acknowledge(openQuestion: boolean) {
        if (!selected || busy)
            return;
        setBusy(true);
        setError('');
        try {
            await api('/messages/' + selected.id + '/read', z.strictObject({ ok: z.boolean() }), { method: 'POST' });
            if (openQuestion)
                onQuestion(selected);
            setSelected(null);
            await onRefresh();
        }
        catch (error) {
            setError(error instanceof Error ? error.message : '确认消息失败，请重试。');
        }
        finally {
            setBusy(false);
        }
    }
    return <>{!!messages.length && <QuestionNotices label="老师消息" title={'老师消息 · ' + messages.length + ' 条'} tone="info" emphasis>{messages.map(message => <button key={message.id} onClick={() => { setError(''); setSelected(message); }}><span className="notice-question">{message.examTitle} · {message.moduleTitle} · 第{message.position}题<span>{message.teacherName}：{message.message.slice(0, 80)}{message.message.length > 80 ? '…' : ''}</span></span><Icon name="chevron-right"/></button>)}</QuestionNotices>}
      {selected && <Dialog title="老师消息" onClose={() => { if (!busy)
        setSelected(null); }}><p className="muted">{selected.teacherName} · {new Date(selected.createdAt).toLocaleString('zh-CN')}</p><p>{selected.examTitle} · {selected.moduleTitle} · 第{selected.position}题</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selected.message}</p><ErrorText error={error}/><div className="dialog-footer"><button disabled={busy} onClick={() => void acknowledge(false)}>我已阅读</button><button className="primary" disabled={busy} onClick={() => void acknowledge(true)}>查看本题</button></div></Dialog>}
    </>;
}
