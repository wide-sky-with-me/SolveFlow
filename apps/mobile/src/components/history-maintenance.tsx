import { useState } from 'react';
import type { LocalRepository, LocalStorageIssue } from '@solveflow/client/local';
import { MotionModal as Modal } from './motion-modal';
import { PageHeader } from './page-header';
import { SafeAreaView, ScrollView, Text, View } from '../theme/primitives';
import { Button, Notice, s } from './ui';

export function HistoryMaintenance({ repository, onClose, onExport, onRestore, onChanged }: {
  repository: LocalRepository; onClose: () => void; onExport: () => void;
  onRestore: (id: string) => void; onChanged: () => void;
}) {
  const [issues, setIssues] = useState(repository.issues); const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<LocalStorageIssue | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function repair() {
    if (!confirm || busy) return; setBusy(true); setError('');
    try { await repository.repairAuxiliary(confirm.key); await repository.recoverInterrupted(); await repository.listHistory(); setIssues(repository.issues); setConfirm(null); onChanged(); }
    catch { setError('未能修复，请检查存储空间后重试。题图和解答未被删除。'); }
    finally { setBusy(false); }
  }
  return <Modal visible animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}><SafeAreaView style={{ flex: 1 }}><PageHeader title="记录维护" onBack={onClose} disabled={busy} /><ScrollView contentContainerStyle={s.pageContent}>
    <Text style={s.subtitle}>无法读取的记录已保留并暂时隔离。其他题目可继续使用；导出会明确列出未包含的题数。</Text>
    {error ? <Notice error text={error} /> : null}
    {confirm ? <View style={{ gap: 12 }}><Text style={s.label}>{confirm.key.startsWith('favorite.') ? '重置这道题损坏的收藏状态？' : '恢复批次原来的名称？'}</Text><Text style={s.subtitle}>仅移除无法读取的附加信息，原题图片和全部解答保留。</Text><Button title="确认修复" disabled={busy} onPress={() => void repair()} /><Button title="暂不修复" secondary disabled={busy} onPress={() => setConfirm(null)} /></View> : <>
      {!issues.length && <Text style={s.subtitle}>已检测的问题均已处理。</Text>}
      {issues.slice(page * 20, page * 20 + 20).map(issue => <View key={issue.key} style={{ gap: 8 }}>
        <Text style={s.label}>{issue.key.startsWith('favorite.') ? '收藏信息' : issue.key.startsWith('batch-title.') ? '批次名称' : issue.key.startsWith('image.') ? '原题图片' : issue.key.startsWith('material.') ? '补充材料' : '题目记录'}无法读取{issue.sessionId ? ` · ${issue.sessionId.slice(-8)}` : ''}</Text>
        {issue.repairable ? <Button title="修复附加信息" secondary onPress={() => setConfirm(issue)} /> : issue.sessionId && /^(record|image|material)\./.test(issue.key) ? <Button title="从备份恢复这道题" secondary onPress={() => onRestore(issue.sessionId!)} /> : <Text style={s.subtitle}>原数据保留，未自动删除或覆盖。</Text>}
      </View>)}
      {page > 0 && <Button title="上一页问题" secondary onPress={() => setPage(value => value - 1)} />}
      {(page + 1) * 20 < issues.length && <Button title="下一页问题" secondary onPress={() => setPage(value => value + 1)} />}
      <Button title="导出可读取记录" onPress={onExport} />
    </>}
  </ScrollView></SafeAreaView></Modal>;
}
