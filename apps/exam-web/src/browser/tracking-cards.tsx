import { useState } from 'react';
import type { z } from 'zod';
import { EXAM_LABELS } from '@solveflow/contracts/exam';
import type { ExamProgressSchema } from '@solveflow/contracts/managed-exam';
import { ExamClock } from './exam-clock.js';
import './tracking-cards.css';

type Progress = z.infer<typeof ExamProgressSchema>;
type GroupMode = 'sitting' | 'student';

function cardStatusBadge(item: Progress): { label: string; className: string } {
    if (item.attention > 0) return { label: `待处理 ${item.attention} 题`, className: 'badge red' };
    if (item.active > 0) return { label: `处理中 ${item.active}`, className: 'badge blue' };
    if (item.entryState === 'ended' || item.timing.endedAt) return { label: '已结束', className: 'badge' };
    if (item.entryState === 'expired') return { label: '已过期', className: 'badge' };
    if (item.entryState === 'upcoming') return { label: '待开始', className: 'badge' };
    if (item.attemptId) return { label: '进行中', className: 'badge green' };
    return { label: '未进入', className: 'badge' };
}

function sortItems(items: readonly Progress[]): Progress[] {
    return [...items].sort((a, b) =>
        b.attention - a.attention
        || b.active - a.active
        || Number(b.online) - Number(a.online)
        || Number(Boolean(b.attemptId && !b.timing.endedAt)) - Number(Boolean(a.attemptId && !a.timing.endedAt))
        || a.studentName.localeCompare(b.studentName, 'zh-CN')
        || a.title.localeCompare(b.title, 'zh-CN'),
    );
}

function TrackingCard({
    item,
    mode,
    onWatch,
}: {
    item: Progress;
    mode: GroupMode;
    onWatch: (attemptId: string) => void;
}) {
    const status = cardStatusBadge(item);
    const pct = item.total > 0 ? Math.min(100, Math.round((item.answered / item.total) * 100)) : 0;
    const locationText = item.moduleTitle
        ? item.moduleTitle + (item.currentPosition ? ` · 第${item.currentPosition}题` : '')
        : item.attemptId ? '已入场' : '尚未进入模块';
    const heading = mode === 'sitting' ? item.studentName : item.title;
    const subheading = mode === 'sitting'
        ? (item.studentUsername ? `@${item.studentUsername}` : '')
        : [item.eventTitle && item.eventTitle !== item.title ? item.eventTitle : '', item.exam ? EXAM_LABELS[item.exam] : ''].filter(Boolean).join(' · ');

    return (
        <article
            className={'tracking-card' + (item.attemptId ? ' is-clickable' : '')}
            aria-label={`${item.studentName} · ${item.title}`}
            onClick={() => { if (item.attemptId) onWatch(item.attemptId); }}
        >
            <div className="tracking-card-head">
                <div className="tracking-card-identity">
                    <strong>{heading}</strong>
                    {subheading && <span className="tracking-sub">{subheading}</span>}
                </div>
                <span className={status.className}>{status.label}</span>
            </div>

            <div className="tracking-card-meta">
                {mode === 'sitting' ? (
                    <span className="tracking-online">
                        <i className={'connection-dot' + (item.online ? ' online' : '')}/>
                        {item.online ? '在线' : '离线'}
                    </span>
                ) : (
                    <span className="tracking-sub">进度 {pct}%</span>
                )}
                <span className={'tracking-location' + (item.moduleTitle ? '' : ' is-idle')} title={locationText}>
                    {locationText}
                </span>
            </div>

            <div
                className="module-track tracking-progress-track"
                role="progressbar"
                aria-label={`${item.studentName} · ${item.title} 答题进度`}
                aria-valuenow={item.answered}
                aria-valuemin={0}
                aria-valuemax={item.total || 1}
            >
                <i style={{ width: pct + '%' }}/>
            </div>

            <div className="tracking-metrics">
                <div className="tracking-metric">
                    <span>已有答案</span>
                    <strong>{item.answered} / {item.total}</strong>
                </div>
                <div className="tracking-metric">
                    <span>AI 核验 / 人工</span>
                    <strong>{item.verified} / {item.humanConfirmed}</strong>
                </div>
                <div className="tracking-metric">
                    <span>未拍 / 跳过</span>
                    <strong>{item.attemptId ? `${item.unphotographed} / ${item.skipped}` : '—'}</strong>
                </div>
                <div className="tracking-metric">
                    <span>考试用时</span>
                    <strong><ExamClock timing={item.timing} compact/></strong>
                </div>
            </div>

            <div className="tracking-card-foot">
                <span className="tracking-extra">
                    {item.navigationAt ? `最近活动 ${new Date(item.navigationAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : (item.attemptId ? '暂无切题记录' : '等待学生开始')}
                </span>
                <button
                    type="button"
                    className="secondary tracking-open-btn"
                    disabled={!item.attemptId}
                    onClick={e => {
                        e.stopPropagation();
                        if (item.attemptId) onWatch(item.attemptId);
                    }}
                >
                    {item.attemptId ? '查看' : '尚未入场'}
                </button>
            </div>
        </article>
    );
}

export function TrackingCardsBoard({
    items,
    total,
    onlineTotal,
    onWatch,
}: {
    items: readonly Progress[];
    total: number;
    onlineTotal?: number | undefined;
    onWatch: (attemptId: string) => void;
}) {
    const [mode, setMode] = useState<GroupMode>('sitting');

    const sittingGroups = (() => {
        const map = new Map<string, {
            key: string;
            title: string;
            eventTitle: string;
            examLabel: string;
            items: Progress[];
            onlineCount: number;
            answered: number;
            total: number;
            active: number;
            attention: number;
        }>();
        for (const item of items) {
            const key = item.sittingId ?? item.title;
            let group = map.get(key);
            if (!group) {
                group = {
                    key,
                    title: item.title,
                    eventTitle: item.eventTitle && item.eventTitle !== item.title ? item.eventTitle : '',
                    examLabel: item.exam ? EXAM_LABELS[item.exam] : '',
                    items: [],
                    onlineCount: 0,
                    answered: 0,
                    total: 0,
                    active: 0,
                    attention: 0,
                };
                map.set(key, group);
            }
            group.items.push(item);
            if (item.online) group.onlineCount += 1;
            group.answered += item.answered;
            group.total += item.total;
            group.active += item.active;
            group.attention += item.attention;
        }
        return [...map.values()]
            .map(group => ({ ...group, items: sortItems(group.items) }))
            .sort((a, b) => b.attention - a.attention || b.active - a.active || b.onlineCount - a.onlineCount);
    })();

    const studentGroups = (() => {
        const map = new Map<string, {
            key: string;
            studentName: string;
            studentUsername: string;
            online: boolean;
            items: Progress[];
            answered: number;
            total: number;
            active: number;
            attention: number;
        }>();
        for (const item of items) {
            const key = item.studentId ?? (item.studentUsername ? `u:${item.studentUsername}` : `n:${item.studentName}`);
            let group = map.get(key);
            if (!group) {
                group = {
                    key,
                    studentName: item.studentName,
                    studentUsername: item.studentUsername ?? '',
                    online: item.online,
                    items: [],
                    answered: 0,
                    total: 0,
                    active: 0,
                    attention: 0,
                };
                map.set(key, group);
            }
            group.items.push(item);
            group.online = group.online || item.online;
            group.answered += item.answered;
            group.total += item.total;
            group.active += item.active;
            group.attention += item.attention;
        }
        return [...map.values()]
            .map(group => ({ ...group, items: sortItems(group.items) }))
            .sort((a, b) => b.attention - a.attention || b.active - a.active || Number(b.online) - Number(a.online) || a.studentName.localeCompare(b.studentName, 'zh-CN'));
    })();

    return (
        <>
            <div className="tracking-bar">
                <div className="tracking-summary">
                    <span>共 {total} 条安排</span>
                    {onlineTotal !== undefined && <span>· {onlineTotal} 位在线</span>}
                </div>
                <div className="management-tabs tracking-view-tabs" role="tablist" aria-label="跟踪分组方式">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === 'sitting'}
                        className={mode === 'sitting' ? 'selected' : ''}
                        onClick={() => setMode('sitting')}
                    >
                        按场次分组
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === 'student'}
                        className={mode === 'student' ? 'selected' : ''}
                        onClick={() => setMode('student')}
                    >
                        按学生分组
                    </button>
                </div>
            </div>

            <div className="tracking-groups">
                {mode === 'sitting'
                    ? sittingGroups.map(group => (
                        <section className="tracking-group" key={group.key} aria-label={`场次 · ${group.title}`}>
                            <div className="tracking-group-head">
                                <div className="tracking-group-title">
                                    <h3>{group.title}</h3>
                                    {group.eventTitle && <span className="badge">{group.eventTitle}</span>}
                                    {group.examLabel && <span className="badge blue">{group.examLabel}</span>}
                                </div>
                                <div className="tracking-group-stats">
                                    <span>本页 {group.items.length} 人 · 在线 {group.onlineCount}</span>
                                    <span>已答 {group.answered} / {group.total}</span>
                                    {group.active > 0 && <span className="badge blue">处理中 {group.active}</span>}
                                    {group.attention > 0 && <span className="badge red">待处理 {group.attention} 题</span>}
                                </div>
                            </div>
                            <div className="tracking-cards-grid">
                                {group.items.map(item => (
                                    <TrackingCard key={item.assignmentId} item={item} mode="sitting" onWatch={onWatch}/>
                                ))}
                            </div>
                        </section>
                    ))
                    : studentGroups.map(group => (
                        <section className="tracking-group" key={group.key} aria-label={`学生 · ${group.studentName}`}>
                            <div className="tracking-group-head">
                                <div className="tracking-group-title">
                                    <h3>{group.studentName}</h3>
                                    {group.studentUsername && <span className="tracking-sub">@{group.studentUsername}</span>}
                                    <span className="tracking-online">
                                        <i className={'connection-dot' + (group.online ? ' online' : '')}/>
                                        {group.online ? '在线' : '离线'}
                                    </span>
                                </div>
                                <div className="tracking-group-stats">
                                    <span>本页 {group.items.length} 场考试</span>
                                    <span>累计已答 {group.answered} / {group.total}</span>
                                    {group.active > 0 && <span className="badge blue">处理中 {group.active}</span>}
                                    {group.attention > 0 && <span className="badge red">待处理 {group.attention} 题</span>}
                                </div>
                            </div>
                            <div className="tracking-cards-grid">
                                {group.items.map(item => (
                                    <TrackingCard key={item.assignmentId} item={item} mode="student" onWatch={onWatch}/>
                                ))}
                            </div>
                        </section>
                    ))}
            </div>
        </>
    );
}
