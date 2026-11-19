import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
    ExamRoleListSchema,
    ExamRoleProfileSchema,
    ExamUserPageSchema,
    type ExamRole,
    type ExamRoleProfile,
    type ExamUser,
} from '@solveflow/contracts/managed-exam';
import { api, post } from './api.js';
import { Dialog, ErrorText, Feedback, RefreshButton } from './components.js';
import { ListSearch, Pagination, pageUrl, useCanonicalPage, useListQuery, usePageResource } from './paging.js';
import { RemoteMultiSelect } from './remote-select.js';
import { newRequestId } from './request-id.js';
import './role-permissions.css';

type RoleSpec = {
    defaultName: string;
    tone: 'blue' | 'green' | 'amber';
    defaultSummary: string;
    scopeDetail: string;
    allowed: readonly string[];
    boundaries: readonly string[];
};

const ROLE_SPECS: Record<ExamRole, RoleSpec> = {
    admin: {
        defaultName: '系统管理员',
        tone: 'blue',
        defaultSummary: '拥有全平台账号身份、角色授权、主备模型服务与全局场次的最高管理权限。',
        scopeDetail: '覆盖系统内全部未归档场次、全部用户账号以及主备模型密钥与渠道配置。',
        allowed: [
            '创建、编辑、停用/启用任意用户账号，授予或收回四种系统角色',
            '配置与切换主/备模型服务、允许的供应商域名及连接可用性检测',
            '查看并介入全部场次的看板统计、实时跟踪、待处理题与人工确认',
            '管理所有考试模板、场次创建、名额分配、模拟错题策略与归档',
        ],
        boundaries: [
            '系统禁止停用当前登录管理员自身，或移除自己的系统管理员角色',
            '每位用户至少须保留一个角色；变更角色立即递增会话版本（auth_version）使旧权限失效',
        ],
    },
    manager: {
        defaultName: '场次管理员',
        tone: 'green',
        defaultSummary: '负责本人创建及管辖场次的全流程考务编排、学生新建、人员分配与监考跟踪。',
        scopeDetail: '仅限本人作为管理员（manager_id）创建的场次、本人创建或分配在本场次下的学生及启用中的技术支持名单。',
        allowed: [
            '选择标准目录或新建自定义考试模板，创建、改名、归档本人管理的考试场次与具体考试',
            '新建学生账号，为本场次批量分配学生、指派负责老师并配置模拟错题数量',
            '查看管辖场次的看板、实时跟踪卡片、待处理题队列，执行重答、核验、人工确认与提前结束',
        ],
        boundaries: [
            '不可访问「服务配置」与「角色权限」，不可创建或提权管理员/技术支持角色',
            '不可查看或修改其他场次管理员创建的独立场次及未关联学生记录',
        ],
    },
    support: {
        defaultName: '老师 / 技术支持',
        tone: 'amber',
        defaultSummary: '专注考中与考后单题质量保障，跟进名下分配学生的答题进度、异常核验与人工确认。',
        scopeDetail: '严格限定于当前分配在名下且未撤回（staff_assignments）的具体考试安排；兼具学生身份不会扩大教师可见范围。',
        allowed: [
            '在看板、实时跟踪卡片与右下角提醒中监控负责学生的在线状态、当前题位与计时',
            '查看学生原图、补图、AI 推导与核验依据，发起「AI 重答」「重新核验」或填写「人工确认」答案',
            '向负责学生的指定题目发送独立教师提醒消息，或在必要时协助结束考试',
        ],
        boundaries: [
            '不可新建用户、新建模板、发布/删除场次或修改师生分配关系',
            '一旦被场次管理员从某场考试撤回指派，对该场题位与图片的读写权限立即终止',
        ],
    },
    student: {
        defaultName: '学生',
        tone: 'green',
        defaultSummary: '在开放窗口内进入本人获配考试，完成逐题拍照上传、接收答案与解决通知、回看本人记录。',
        scopeDetail: '仅限本人账号名下的考试安排、本人上传的题图及已发布的展示答案；无安排时可使用受每日额度限制的临时拍题。',
        allowed: [
            '在开放时间内入场作答（单场互斥），上传首拍、重拍或最多 7 张同题补图（单场上限 1 GiB）',
            '实时接收首版答案草稿、独立核验结果、老师人工确认通知及逐题教师消息',
            '随时打开本节总览跳转题位、主动结束当前考试，或在「考试记录」回看历史已结束场次',
        ],
        boundaries: [
            '严禁访问任何管理端页面与接口，不可读取其他学生题图、模型内部推理（thinking）或模拟策略原答案',
            '考试结束后冻结计时并停止新题图提交，该场未处理的提醒自动消去不再跨场干扰',
        ],
    },
};

const ROLE_LABELS: Record<ExamRole, string> = {
    admin: '系统管理员',
    manager: '场次管理员',
    support: '老师 / 技术支持',
    student: '学生',
};

function RoleMembersDialog({
    role,
    currentUserId,
    onClose,
    onChanged,
}: {
    role: ExamRoleProfile;
    currentUserId: string;
    onClose: () => void;
    onChanged: () => void;
}) {
    const list = useListQuery();
    const resource = usePageResource(
        ExamUserPageSchema,
        pageUrl('/admin/users/page', { role: role.code, page: list.page, pageSize: list.pageSize, q: list.q }),
        0,
    );
    useCanonicalPage(list.page, resource.data, list.setPage);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [grantFormKey, setGrantFormKey] = useState(0);
    const grantReq = useRef<{ signature: string; id: string } | null>(null);

    async function handleGrant(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        const userIds = [...new Set(form.getAll('userIds').map(String).filter(Boolean))];
        if (!userIds.length) {
            setError('请先在下拉框中选择至少一位用户。');
            return;
        }
        const signature = userIds.slice().sort().join(',');
        if (grantReq.current?.signature !== signature) {
            grantReq.current = { signature, id: newRequestId() };
        }
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await api('/admin/roles/' + role.code + '/members', ExamRoleProfileSchema, post({
                requestId: grantReq.current.id,
                action: 'grant',
                userIds,
            }));
            grantReq.current = null;
            setGrantFormKey(value => value + 1);
            setNotice(`已为 ${userIds.length} 位用户授予「${role.name}」角色。`);
            await resource.refresh(true);
            onChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : '授予角色失败。');
        } finally {
            setBusy(false);
        }
    }

    async function handleRevoke(person: ExamUser) {
        if (busy) return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await api('/admin/roles/' + role.code + '/members', ExamRoleProfileSchema, post({
                requestId: newRequestId(),
                action: 'revoke',
                userIds: [person.id],
            }));
            setNotice(`已移除「${person.displayName}」的${role.name}角色。`);
            await resource.refresh(true);
            onChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : '移除角色失败。');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog title={`管理角色成员 · ${role.name}`} onClose={() => { if (!busy) onClose(); }}>
            <div className="role-members-dialog">
                <ErrorText error={error}/>
                {notice && <Feedback tone="success">{notice}</Feedback>}
                <form className="role-grant-form" key={grantFormKey} onSubmit={e => void handleGrant(e)}>
                    <RemoteMultiSelect
                        schema={ExamUserPageSchema}
                        endpoint="/admin/users/page"
                        params={{ state: 'active' }}
                        label="批量添加成员（可搜索姓名或用户名）"
                        name="userIds"
                        max={100}
                        disabled={busy}
                    />
                    <div className="role-grant-actions">
                        <button type="submit" className="primary" disabled={busy}>
                            {busy ? '处理中…' : `授予「${role.name}」`}
                        </button>
                    </div>
                </form>

                <div className="list-toolbar">
                    <ListSearch label="筛选当前角色成员" value={list.q} onSearch={value => { list.setQ(value); list.setPage(1); }} disabled={busy}/>
                    <RefreshButton busy={resource.refreshing} disabled={resource.loading || busy} onRefresh={resource.refreshManually}/>
                </div>
                <ErrorText error={resource.error}/>
                {!resource.data && !resource.error && <p className="empty">正在读取成员…</p>}
                {resource.data && !resource.data.items.length && <p className="empty">当前没有匹配的成员</p>}
                {resource.data && resource.data.items.length > 0 && (
                    <div className="role-member-list" role="list" aria-label={`${role.name}成员列表`}>
                        {resource.data.items.map(person => {
                            const isSelfAdmin = role.code === 'admin' && person.id === currentUserId;
                            const isOnlyRole = person.roles.length <= 1;
                            const blockedReason = isSelfAdmin ? '当前登录管理员' : isOnlyRole ? '唯一角色（需先授予其他角色）' : '';
                            return (
                                <div className="role-member-row" role="listitem" key={person.id}>
                                    <div className="role-member-info">
                                        <strong>{person.displayName}</strong>
                                        <span className="role-member-meta">
                                            @{person.username} · 当前身份：{person.roles.map(r => ROLE_LABELS[r]).join('、')}
                                            {person.state === 'disabled' ? ' · 已停用' : ''}
                                        </span>
                                    </div>
                                    {blockedReason ? (
                                        <span className="role-member-guard">{blockedReason}</span>
                                    ) : (
                                        <button type="button" className="quiet" disabled={busy} onClick={() => void handleRevoke(person)}>
                                            移除该角色
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                <Pagination
                    label={`${role.name}成员`}
                    data={resource.data}
                    pendingPage={list}
                    disabled={busy || (resource.loading && !resource.data)}
                    onPage={list.setPage}
                    onPageSize={list.setPageSize}
                />
            </div>
        </Dialog>
    );
}

export function RolePermissions({ currentUser, onUsersChanged }: { currentUser: ExamUser; onUsersChanged: () => void }) {
    const resource = usePageResource(ExamRoleListSchema, '/admin/roles');
    const [editing, setEditing] = useState<ExamRoleProfile | null>(null);
    const [managingCode, setManagingCode] = useState<ExamRole | null>(null);
    const [nameDraft, setNameDraft] = useState('');
    const [summaryDraft, setSummaryDraft] = useState('');
    const [noteDraft, setNoteDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState('');
    const editReq = useRef<{ signature: string; id: string } | null>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);

    const items = resource.data?.items ?? [];
    const managingRole = managingCode ? items.find(item => item.code === managingCode) ?? null : null;

    useEffect(() => {
        if (!editing) return;
        const spec = ROLE_SPECS[editing.code];
        setNameDraft(editing.name || spec.defaultName);
        setSummaryDraft(editing.summary || spec.defaultSummary);
        setNoteDraft(editing.note);
        setSaveError('');
        editReq.current = null;
    }, [editing]);

    async function saveProfile(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!editing || busy) return;
        const trimmedName = nameDraft.trim();
        if (!trimmedName) {
            setSaveError('请填写角色显示名称。');
            nameInputRef.current?.focus();
            return;
        }
        const payload = {
            name: trimmedName,
            summary: summaryDraft.trim(),
            note: noteDraft.trim(),
        };
        const signature = JSON.stringify([editing.code, payload]);
        if (editReq.current?.signature !== signature) {
            editReq.current = { signature, id: newRequestId() };
        }
        setBusy(true);
        setSaveError('');
        try {
            await api('/admin/roles/' + editing.code, ExamRoleProfileSchema, post({
                requestId: editReq.current.id,
                ...payload,
            }));
            editReq.current = null;
            setEditing(null);
            await resource.refresh(true);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : '保存角色说明失败。');
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="roles-panel" aria-label="角色与权限管理">
            <div className="panel roles-head">
                <div className="roles-head-copy">
                    <h2>角色与权限矩阵</h2>
                    <p>平台采用四级内置角色与数据行级隔离机制。可在此查阅每类角色的精确权限边界、编辑团队职责备注，或直接批量调整角色成员（修改后实时更新会话版本立即生效）。</p>
                </div>
                <RefreshButton secondary busy={resource.refreshing} disabled={resource.loading} onRefresh={resource.refreshManually}/>
            </div>

            <ErrorText error={resource.error}/>
            {!resource.data && !resource.error && <section className="panel"><p className="empty">正在读取角色权限…</p></section>}

            {items.length > 0 && (
                <div className="roles-grid">
                    {items.map(profile => {
                        const spec = ROLE_SPECS[profile.code];
                        const displaySummary = profile.summary.trim() || spec.defaultSummary;
                        return (
                            <article className="role-card" key={profile.code} aria-label={profile.name}>
                                <div className="role-card-head">
                                    <div className="role-card-title">
                                        <div className="role-card-heading">
                                            <h3>{profile.name}</h3>
                                            <span className={'badge ' + spec.tone}>{profile.code}</span>
                                        </div>
                                        <span className="role-card-counts">
                                            {profile.memberCount} 位正常成员{profile.disabledCount > 0 ? ` · ${profile.disabledCount} 位已停用` : ''}
                                        </span>
                                    </div>
                                    <div className="role-card-actions">
                                        <button type="button" className="secondary" onClick={() => setEditing(profile)}>编辑说明</button>
                                        <button type="button" className="primary" onClick={() => setManagingCode(profile.code)}>管理成员</button>
                                    </div>
                                </div>

                                <p className="role-summary">{displaySummary}</p>

                                <div className={'role-note' + (profile.note ? '' : ' is-empty')}>
                                    {profile.note
                                        ? <><strong>职责备注：</strong>{profile.note}</>
                                        : '暂无自定义职责备注，可点击「编辑说明」补充团队值班分工或操作约定。'}
                                </div>

                                <div className="role-matrix">
                                    <div className="role-matrix-group">
                                        <span className="role-matrix-label">数据可见范围</span>
                                        <ul className="role-matrix-list">
                                            <li>{spec.scopeDetail}</li>
                                        </ul>
                                    </div>
                                    <div className="role-matrix-group">
                                        <span className="role-matrix-label">可执行操作</span>
                                        <ul className="role-matrix-list">
                                            {spec.allowed.map(line => <li key={line}>{line}</li>)}
                                        </ul>
                                    </div>
                                    <div className="role-matrix-group">
                                        <span className="role-matrix-label">安全与越权边界</span>
                                        <ul className="role-matrix-list is-boundary">
                                            {spec.boundaries.map(line => <li key={line}>{line}</li>)}
                                        </ul>
                                    </div>
                                </div>

                                <div className="role-members-preview">
                                    <span className="role-matrix-label">当前成员预览</span>
                                    {profile.members.length === 0 ? (
                                        <span className="role-member-guard">暂无成员</span>
                                    ) : (
                                        <div className="role-member-chips">
                                            {profile.members.slice(0, 6).map(member => (
                                                <span className="role-member-chip" key={member.id} title={`${member.displayName} (@${member.username})`}>
                                                    {member.displayName}<small>@{member.username}</small>
                                                </span>
                                            ))}
                                            {(profile.memberCount + profile.disabledCount) > 6 && (
                                                <span className="role-member-chip">
                                                    等共 {profile.memberCount + profile.disabledCount} 人
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {editing && (
                <Dialog
                    title={`编辑角色说明 · ${ROLE_SPECS[editing.code].defaultName}`}
                    notice={saveError ? <ErrorText error={saveError}/> : null}
                    onClose={() => { if (!busy) setEditing(null); }}
                >
                    <form onSubmit={e => void saveProfile(e)}>
                        <label>
                            显示名称
                            <input
                                ref={nameInputRef}
                                name="name"
                                required
                                maxLength={40}
                                value={nameDraft}
                                onChange={e => setNameDraft(e.target.value)}
                            />
                        </label>
                        <label>
                            定位与范围概述（最多 240 字）
                            <textarea
                                name="summary"
                                rows={3}
                                maxLength={240}
                                value={summaryDraft}
                                onChange={e => setSummaryDraft(e.target.value)}
                                placeholder={ROLE_SPECS[editing.code].defaultSummary}
                            />
                        </label>
                        <label>
                            职责与协作备注（选填，最多 1000 字）
                            <textarea
                                name="note"
                                rows={4}
                                maxLength={1000}
                                value={noteDraft}
                                onChange={e => setNoteDraft(e.target.value)}
                                placeholder="例如：考中主值班老师负责盯待处理队列，副值班老师负责核对补图…"
                            />
                        </label>
                        <div className="dialog-footer">
                            <button
                                type="button"
                                className="quiet"
                                disabled={busy}
                                onClick={() => {
                                    const spec = ROLE_SPECS[editing.code];
                                    setNameDraft(spec.defaultName);
                                    setSummaryDraft(spec.defaultSummary);
                                    setNoteDraft('');
                                }}
                            >
                                恢复默认文案
                            </button>
                            <button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button>
                            <button type="submit" className="primary" disabled={busy}>{busy ? '保存中…' : '保存说明'}</button>
                        </div>
                    </form>
                </Dialog>
            )}

            {managingRole && (
                <RoleMembersDialog
                    role={managingRole}
                    currentUserId={currentUser.id}
                    onClose={() => setManagingCode(null)}
                    onChanged={() => {
                        void resource.refresh(true);
                        onUsersChanged();
                    }}
                />
            )}
        </section>
    );
}
