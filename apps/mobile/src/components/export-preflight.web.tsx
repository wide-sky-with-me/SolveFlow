import { useEffect, useState } from 'react';
import type { ExportStorageUsage } from '@solveflow/contracts/local';
import type { ExportPreflightIssue } from '../local/export-preflight';
import { exportStorageBlock } from '../local/export-preflight';
import { Button, Notice } from './ui';
import './export-preflight.web.css';

export function ExportPreflight({ canNavigate, issues, storage, storageError, checking, busy, onCheck, onManage, onReview }: { canNavigate: boolean; issues: readonly ExportPreflightIssue[]; storage: ExportStorageUsage | null; storageError: string; checking: boolean; busy: boolean; onCheck: () => void; onManage: () => void; onReview: (issue: ExportPreflightIssue) => void }) {
  const blocked = issues.filter(issue => issue.blocking).length;
  const capacityError = exportStorageBlock(storage);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (blocked || capacityError || storageError) setOpen(true); }, [blocked, capacityError, storageError]);
  const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  return <details className="pdf-disclosure pdf-preflight" data-testid="export-preflight" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>导出检查{blocked ? ` · ${blocked} 题需处理` : issues.length ? ` · ${issues.length} 题需核对` : ''}{capacityError ? ' · 空间不足' : ''}</summary>
    <div className="pdf-disclosure-content">
      <div className="pdf-preflight-storage">
        <span role="status">{storage ? `导出缓存 ${mib(storage.usedBytes)} / ${mib(storage.limitBytes)} MiB · 可用 ${mib(storage.availableBytes)} MiB` : checking ? '正在检查导出缓存…' : '导出缓存尚未检查'}</span>
        <div className="pdf-preflight-actions"><Button title="重新检查" compact secondary disabled={busy || checking} onPress={onCheck} /><Button title="管理导出记录" compact secondary disabled={busy} onPress={onManage} /></div>
      </div>
      {!!(storageError || capacityError) && <Notice text={storageError || capacityError!} error />}
      {!!issues.length && <ul className="pdf-preflight-issues">{issues.map(issue => <li key={issue.key} data-blocking={issue.blocking}>
        <button type="button" className="pdf-preflight-question" disabled={busy} onClick={() => onReview(issue)} aria-label={canNavigate ? `打开第${issue.ordinal}题` : `查看第${issue.ordinal}题原图`}>第 {issue.ordinal} 题</button>
        <span>{issue.messages.join('；')}</span>
      </li>)}</ul>}
    </div>
  </details>;
}
