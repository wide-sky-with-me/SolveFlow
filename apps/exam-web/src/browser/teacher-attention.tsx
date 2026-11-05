import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExamIssueQueueSchema, type ExamIssueQueueItem } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { alertLabels, ErrorText } from './components.js';
import { usePageResource } from './paging.js';

export function TeacherAttention({ hidden, onOpen, onViewAll }: { hidden: boolean; onOpen: (item: ExamIssueQueueItem) => void; onViewAll: () => void }) {
    const { data, error } = usePageResource(ExamIssueQueueSchema, '/admin/issues?limit=3');
    const [expanded, setExpanded] = useState(false);
    useEffect(() => { if ((data?.total ?? 0) < 2) setExpanded(false); }, [data?.total]);
    const [host, setHost] = useState<Element>(() => document.fullscreenElement ?? document.body);
    useEffect(() => {
        const change = () => setHost(document.fullscreenElement ?? document.body);
        document.addEventListener('fullscreenchange', change);
        return () => document.removeEventListener('fullscreenchange', change);
    }, []);
    if (hidden || !data?.total && !error) return null;
    return createPortal(<aside className="teacher-attention" aria-label="教师待处理提醒">
      {!!data?.total && <>
        <button className="teacher-attention-heading" aria-label="打开教师待处理提醒" aria-expanded={data.total > 1 ? expanded : undefined} onClick={() => { const first = data.items[0]; if (data.total === 1 && first) onOpen(first); else setExpanded(value => !value); }}>
          <span className="teacher-attention-mark"><Icon name="alert"/></span><strong aria-live="polite">待处理 · {data.total} 题</strong><Icon name={data.total > 1 ? 'chevron-down' : 'chevron-right'}/>
        </button>
        {expanded && data.total > 1 && <div className="teacher-attention-items">{data.items.map(item => <button key={item.id} onClick={() => onOpen(item)}>
          <span><strong>{item.studentName}</strong><span>{item.moduleTitle} · 第{item.position}题</span><span>{alertLabels[item.reason]}</span></span><Icon name="chevron-right"/>
        </button>)}</div>}
        {expanded && data.total > 1 && <button className="teacher-attention-all" aria-label="查看全部待处理题" onClick={onViewAll}>查看全部 {data.total} 题<Icon name="chevron-right"/></button>}
      </>}
      <ErrorText error={error}/>
    </aside>, host);
}
