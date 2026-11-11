import { ExamUserPageSchema } from '@solveflow/contracts/managed-exam';
import type { ExamEvent } from '@solveflow/contracts/exam-events';
import { Select } from '@solveflow/web-ui/select';
import { Dialog, ErrorText } from './components.js';
import { ListSearch, Pagination, pageUrl, useCanonicalPage, useListQuery, usePageResource } from './paging.js';
import { FilterActions, useStagedFilters } from './list-filters.js';

export function EventMembers({ parent, onClose }: {
    parent: ExamEvent;
    onClose: () => void;
}) {
    const list = useListQuery(), query = useStagedFilters({ q: '', role: 'student' });
    function applyFilters() { query.apply(); list.setPage(1); }
    function resetFilters() { query.reset(); list.setPage(1); }
    const resource = usePageResource(ExamUserPageSchema, pageUrl('/admin/exam-events/' + parent.id + '/members/page', {
        page: list.page,
        pageSize: list.pageSize,
        ...query.applied,
    }));
    useCanonicalPage(list.page, resource.data, list.setPage);

    return <Dialog title="场次参与人员" size="wide" onClose={onClose}>
        <p className="muted">{parent.title} · 按具体考试分配自动汇总</p>
        <div className="list-toolbar student-list-tools">
            <ListSearch label="搜索参与人员" value={query.draft.q??''} onDraftChange={value=>query.setField('q',value)} onSearch={applyFilters}/>
            <Select
                label="人员类型"
                value={query.draft.role??'student'}
                onChange={value=>query.setField('role',value)}
                options={[{ value: 'student', label: '学生' }, { value: 'support', label: '老师' }]}
            />
            <FilterActions {...query} onApply={applyFilters} onReset={resetFilters}/>
        </div>
        <ErrorText error={resource.error}/>
        {resource.data && <div className="table-wrap">
            <table>
                <thead><tr><th>姓名</th><th>用户名</th><th>状态</th></tr></thead>
                <tbody>
                    {resource.data.items.map(item => <tr key={item.id}>
                        <td>{item.displayName}</td>
                        <td>{item.username}</td>
                        <td>{item.state === 'active' ? '正常' : '已停用'}</td>
                    </tr>)}
                </tbody>
            </table>
            {!resource.data.total && <p className="empty">暂无参与人员</p>}
        </div>}
        <Pagination label="参与人员" data={resource.data} pendingPage={list}
            onPage={list.setPage} onPageSize={list.setPageSize}/>
    </Dialog>;
}
