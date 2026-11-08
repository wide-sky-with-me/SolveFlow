import { useEffect, useRef, useState } from 'react';
import { EXAM_LABELS, ExamTypeSchema } from '@solveflow/contracts/exam';
import { ExamEventPageSchema, ExamConcretePageSchema, type ExamEvent, type ExamConcrete } from '@solveflow/contracts/exam-events';
import { Select } from '@solveflow/web-ui/select';
import { Icon } from '@solveflow/web-ui/icons';
import { api, idResponse, post } from './api.js';
import { Dialog, ErrorText, RefreshButton } from './components.js';
import { allocationToken } from './allocation-fields.js';
import { ListSearch, Pagination, pageUrl, useCanonicalPage, useListQuery, usePageResource } from './paging.js';
import { formatExamWindow } from './exam-presentation.js';
import { EventEditor, ConcreteEditor } from './exam-event-editors.js';
import { EventMembers } from './exam-event-members.js';
import './exam-events.css';

export function ExamEvents({ onManage, createTemplate, onCreateClose, onSaved }: {
    onManage: (id: string) => void;
    createTemplate: string | null;
    onCreateClose: () => void;
    onSaved: () => void;
}) {
    const list = useListQuery(), exams = useListQuery();
    const [parent, setParent] = useState<ExamEvent | null>(null),
        [editor, setEditor] = useState<{ item: ExamEvent | null } | null>(null),
        [examEditor, setExamEditor] = useState<{ item: ExamConcrete | null } | null>(null),
        [removing, setRemoving] = useState<{ event: ExamEvent; exam?: ExamConcrete } | null>(null),
        [members, setMembers] = useState<ExamEvent | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const events = usePageResource(ExamEventPageSchema, parent ? null : pageUrl('/admin/exam-events/page', {
        page: list.page,
        pageSize: list.pageSize,
        q: list.q,
        exam: list.filter,
    }));
    const children = usePageResource(ExamConcretePageSchema, parent ? pageUrl('/admin/exam-events/' + parent.id + '/exams/page', {
        page: exams.page,
        pageSize: exams.pageSize,
        q: exams.q,
    }) : null);
    useCanonicalPage(list.page, events.data, list.setPage);
    useCanonicalPage(exams.page, children.data, exams.setPage);
    const selected = children.data?.event ?? parent,
        token = useRef<{ key: string; id: string } | null>(null);

    useEffect(() => {
        if (createTemplate !== null) setEditor({ item: null });
    }, [createTemplate]);

    async function reload() {
        await Promise.all([events.refresh(), children.refresh()]);
        onSaved();
    }

    async function remove() {
        if (!removing || busy) return;
        setBusy(true);
        setError('');
        try {
            const item = removing.exam ?? removing.event,
                payload = { expectedVersion: item.version };
            await api('/admin/exam-events/' + removing.event.id + (removing.exam ? '/exams/' + removing.exam.id : '') + '/delete', idResponse,
                post({ requestId: allocationToken(token, { id: item.id, ...payload }), ...payload }));
            if (!removing.exam) setParent(null);
            setRemoving(null);
            await reload();
        } catch (error) {
            setError(error instanceof Error ? error.message : '删除失败。');
        } finally {
            setBusy(false);
        }
    }

    function closeEditor() {
        setEditor(null);
        onCreateClose();
    }

    return <section className="exam-events" aria-label="场次与具体考试">
        <ErrorText error={error || events.error || children.error}/>
        {selected ? <>
            <div className="event-toolbar">
                <button className="quiet" onClick={() => { setParent(null); setError(''); }}>‹ 全部场次</button>
                <div className="event-toolbar-actions">
                    <button className="secondary" onClick={() => setEditor({ item: selected })}>编辑场次</button>
                    <button className="primary" onClick={() => setExamEditor({ item: null })}>
                        <Icon name="plus"/>新建具体考试
                    </button>
                </div>
            </div>
            <div className="card event-summary">
                <div>
                    <h2>{selected.title}</h2>
                    <p className="muted">{EXAM_LABELS[selected.exam]} · {selected.templateTitle}</p>
                </div>
                <div className="event-counts">
                    <span><strong>{selected.examCount}</strong>具体考试</span>
                    <span><strong>{selected.studentCount}</strong>学生</span>
                    <span><strong>{selected.teacherCount}</strong>老师</span>
                    <button className="quiet" aria-label="查看场次参与人员" onClick={() => setMembers(selected)}>参与人员</button>
                </div>
            </div>
            <div className="list-toolbar student-list-tools">
                <ListSearch label="搜索具体考试" value={exams.q} onSearch={exams.setQ}/>
                <RefreshButton busy={children.refreshing} onRefresh={children.refreshManually}/>
            </div>
            {children.loading && !children.data && <p className="empty">正在读取…</p>}
            {children.data?.items.map(item => <article key={item.id} className="card event-record" aria-label={item.title}>
                <div className="section-head">
                    <h3>{item.title}</h3>
                    <span className="badge">{item.state === 'published'
                        ? item.started ? '已有学生参加' : '已发布'
                        : { closed: '已结束', cancelled: '已取消', draft: '草稿' }[item.state]}</span>
                </div>
                <p className="muted">{formatExamWindow(item.opensAt, item.closesAt)}</p>
                <div className="event-record-bottom">
                    <span className="muted">{item.assignmentCount} 位学生</span>
                    <div className="event-record-actions">
                        <button className="secondary" onClick={() => onManage(item.id)}>人员与错题配置</button>
                        <button className="quiet" onClick={() => setExamEditor({ item })}>编辑</button>
                        <button className="quiet" onClick={() => { setError(''); setRemoving({ event: selected, exam: item }); }}>删除</button>
                    </div>
                </div>
            </article>)}
            {children.data && !children.data.total && <section className="card empty">还没有具体考试</section>}
            <Pagination label="具体考试" data={children.data} pendingPage={exams}
                onPage={exams.setPage} onPageSize={exams.setPageSize}/>
        </> : <>
            <div className="list-toolbar event-list-tools">
                <ListSearch label="搜索场次或模板" value={list.q} onSearch={list.setQ}/>
                <Select label="考试类型" value={list.filter} onChange={list.setFilter} options={[
                    { value: '', label: '全部类型' },
                    ...ExamTypeSchema.options.map(exam => ({ value: exam, label: EXAM_LABELS[exam] })),
                ]}/>
                <button className="primary" onClick={() => setEditor({ item: null })}><Icon name="plus"/>新建场次</button>
            </div>
            {events.loading && !events.data && <p className="empty">正在读取…</p>}
            {events.data?.items.map(item => <article key={item.id} className="card event-record" aria-label={item.title}>
                <div className="section-head">
                    <h3>{item.title}</h3>
                    <span className="badge">{EXAM_LABELS[item.exam]}</span>
                </div>
                <p className="muted">{item.templateTitle}</p>
                <div className="event-record-bottom">
                    <span className="muted">{item.examCount} 个考试 · {item.studentCount} 位学生 · {item.teacherCount} 位老师</span>
                    <div className="event-record-actions">
                        <button className="secondary" onClick={() => { setParent(item); exams.setQ(''); exams.setPage(1); }}>查看考试</button>
                        <button className="quiet" onClick={() => setEditor({ item })}>编辑</button>
                        <button className="quiet" onClick={() => { setError(''); setRemoving({ event: item }); }}>删除</button>
                    </div>
                </div>
            </article>)}
            {events.data && !events.data.total && <section className="card empty">暂无场次</section>}
            <Pagination label="考试场次" data={events.data} pendingPage={list}
                onPage={list.setPage} onPageSize={list.setPageSize}/>
        </>}
        {editor && <EventEditor initial={editor.item} template={createTemplate ?? ''}
            onClose={closeEditor} onSaved={() => { closeEditor(); void reload(); }}/>}
        {examEditor && selected && <ConcreteEditor parent={selected} initial={examEditor.item}
            onClose={() => setExamEditor(null)} onSaved={() => { setExamEditor(null); void reload(); }}/>}
        {members && <EventMembers parent={members} onClose={() => setMembers(null)}/>}
        {removing && <Dialog
            title={removing.exam ? '删除具体考试？' : '删除场次？'}
            onClose={() => { if (!busy) setRemoving(null); }}
        >
            <p>删除“{removing.exam?.title ?? removing.event.title}”后不再显示；已产生的作答记录保留。{!removing.exam ? '下属具体考试会一并归档。' : ''}</p>
            <ErrorText error={error}/>
            <div className="dialog-footer">
                <button disabled={busy} onClick={() => setRemoving(null)}>取消</button>
                <button className="primary" disabled={busy} onClick={() => void remove()}>
                    {busy ? '删除中…' : '确认删除'}
                </button>
            </div>
        </Dialog>}
    </section>;
}
