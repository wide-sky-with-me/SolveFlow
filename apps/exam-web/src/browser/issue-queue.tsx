// Decision: .agents/notes/implemented/architecture/2026-11-04-managed-exam-audit-fixes.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-resolution-notifications.md
import { useEffect, useState } from 'react';
import { ExamIssueQueueSchema, ExamChoicePageSchema, type ExamAssignment, type ExamIssueQueueItem } from '@solveflow/contracts/managed-exam';
import { RemoteSelect } from './remote-select.js';
import { ListSearch } from './paging.js';
import { Select } from '@solveflow/web-ui/select';
import { Icon } from '@solveflow/web-ui/icons';
import { api } from './api.js';
import { alertLabels, ErrorText } from './components.js';
import { FilterActions, useStagedFilters } from './list-filters.js';

export function IssueQueue({ onOpen, initialReason = '', initialSitting = '' }: { assignments?: ExamAssignment[]; onOpen: (item: ExamIssueQueueItem) => void; initialReason?: string; initialSitting?: string }) {
    const query = useStagedFilters({ q: '', reason: initialReason, sittingId: initialSitting, studentId: '' });
    const { reason, sittingId: sitting, studentId: student, q } = query.applied;
    const [cursors, setCursors] = useState<string[]>([]);
    function applyFilters() { query.apply(); setCursors([]); }
    function resetFilters() { query.reset(); setCursors([]); }
    const [result, setResult] = useState<{ key: string; data: ReturnType<typeof ExamIssueQueueSchema.parse> } | null>(null), [error, setError] = useState('');
    const cursor = cursors.at(-1), key = JSON.stringify([reason, sitting, student, cursor,q]);
    const page = result?.key === key ? result.data : null;
    useEffect(() => {
        const controller = new AbortController();
        let pending = false;
        const sync = async () => {
            if (pending) return;
            pending = true;
            try {
                const query = new URLSearchParams({ limit: '30',q:q??'' });
                if (sitting) query.set('sittingId', sitting);
                if (reason) query.set('reason', reason);
                if (student) query.set('studentId', student);
                if (cursor) query.set('cursor', cursor);
                const data = await api('/admin/issues?' + query, ExamIssueQueueSchema, { signal: controller.signal });
                if (!controller.signal.aborted) {
                    if (cursor && !data.items.length) { setCursors([]); setError(''); return; }
                    setResult({ key, data }); setError('');
                }
            } catch (e) {
                if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '同步失败。');
            } finally { pending = false; }
        };
        void sync();
        const timer = setInterval(() => void sync(), 5000);
        return () => { controller.abort(); clearInterval(timer); };
    }, [key, reason, sitting, student, cursor,q]);
    return <section className="panel issue-queue" aria-label="待处理题队列">
      <div className="section-head"><h2>待处理题</h2>{page && <span className="badge red">{page.total} 题</span>}</div>
      <div className="list-toolbar"><ListSearch label="搜索学生、考试或模块" value={query.draft.q??''} onDraftChange={value=>query.setField('q',value)} onSearch={applyFilters}/><RemoteSelect label="具体考试" allLabel="全部考试" value={query.draft.sittingId??''} onChange={value=>query.setField('sittingId',value)} schema={ExamChoicePageSchema} endpoint="/admin/dashboard/sittings/page"/><RemoteSelect label="学生" allLabel="全部学生" value={query.draft.studentId??''} onChange={value=>query.setField('studentId',value)} schema={ExamChoicePageSchema} endpoint="/admin/student-options/page"/><Select label="问题类型" value={query.draft.reason??''} onChange={value=>query.setField('reason',value)} options={[{ value: '', label: '全部问题' }, ...Object.entries(alertLabels).map(([value, label]) => ({ value, label }))]}/><FilterActions {...query} onApply={applyFilters} onReset={resetFilters}/></div>
      <ErrorText error={error}/>
      {!page && !error && <p className="empty">正在同步…</p>}
      {page && !page.items.length && <p className="empty">暂无待处理题</p>}
      {page?.items.map(item => <button className="issue-row" key={item.id} onClick={() => onOpen(item)}><span className="issue-person"><strong>{item.studentName}</strong><span>{item.title}</span></span><span>{item.moduleTitle} · 第{item.position}题</span><span className="badge red">{alertLabels[item.reason]}</span><Icon name="chevron-right"/></button>)}
      {(cursors.length > 0 || page?.nextCursor) && <nav className="queue-pages" aria-label="待处理题分页"><button className="secondary" disabled={!cursors.length} onClick={() => setCursors(values => values.slice(0, -1))}>上一页</button><span>第 {cursors.length + 1} 页</span><button className="secondary" disabled={!page?.nextCursor} onClick={() => { if (page?.nextCursor) setCursors(values => [...values, page.nextCursor ?? '']); }}>下一页</button></nav>}
    </section>;
}
