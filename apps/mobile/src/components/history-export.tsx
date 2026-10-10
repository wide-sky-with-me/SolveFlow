import { useEffect, useRef, useState } from 'react';
import { MotionModal as Modal } from './motion-modal';
import { PageHeader } from './page-header';
import { planHistoryExport, type HistoryExportPlan, type HistoryExportProgress, type LocalRepository } from '@solveflow/client/local';
import { exportHistory } from '../local/export-history';
import { SafeAreaView, ScrollView, Text, View } from '../theme/primitives';
import { Button, Notice, s } from './ui';
export function HistoryExport({ repository, onClose }: { repository: LocalRepository; onClose: () => void }) {
  const controller = useRef<AbortController | null>(null); const alive = useRef(true);
  const [running, setRunning] = useState(false); const [progress, setProgress] = useState<HistoryExportProgress | null>(null);
  const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  const [plan, setPlan] = useState<HistoryExportPlan | null>(null); const [nextPart, setNextPart] = useState(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  async function start() {
    if (controller.current) return;
    const operation = new AbortController(); controller.current = operation; setRunning(true); setMessage(''); setProgress(null); setError(false);
    try {
      const report = (value: HistoryExportProgress) => { if (alive.current) setProgress(value); };
      const current = plan ?? await planHistoryExport(repository, operation.signal, report);
      if (!alive.current) return;
      if (!plan) {
        setPlan(current);
        // Healthy-only export must be visible before the user commits it.
        if (current.skipped.length || repository.issues.length) { setMessage('部分记录无法读取。原数据已保留，请确认后导出可读取记录。'); return; }
      }
      const part = current.parts[nextPart];
      if (!part) { setMessage('没有可导出的记录。'); return; }
      const name = await exportHistory(repository, operation.signal, report, { ids: part.ids, index: nextPart + 1, total: current.parts.length });
      if (alive.current) { setMessage(name ? `已导出：${name}` : '已取消导出。'); if (name) setNextPart(value => value + 1); }
    }
    catch (cause) { if (alive.current) { setError(true); setMessage(cause instanceof Error ? cause.message : '导出失败，请重试。'); } }
    finally { controller.current = null; if (alive.current) setRunning(false); }
  }
  const complete = plan !== null && nextPart >= plan.parts.length;
  const title = running ? '正在导出…' : complete ? plan.parts.length ? '导出完成' : '没有可导出记录' : plan && (plan.skipped.length || repository.issues.length) && nextPart === 0 ? '确认导出可读取记录' : plan && nextPart > 0 ? `导出第 ${nextPart + 1} / ${plan.parts.length} 卷` : '导出到本机';
  return <Modal visible animationType="slide" onRequestClose={() => { if (running) controller.current?.abort(); else onClose(); }}><SafeAreaView style={{ flex: 1 }}><PageHeader title="导出本地记录" onBack={onClose} disabled={running} /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.pageContent}><Text style={s.subtitle}>将题图、全部解答、收藏状态和脱敏诊断保存到你选择的本机目录，不包含模型密钥或模型设置。文件含个人学习内容，请妥善保管。</Text><Text style={s.subtitle}>导出不会删除历史，也不会发送到网络。可通过「我的 → 恢复本地记录」导回应用。</Text><Text style={s.subtitle}>大备份自动按每卷最多128MiB拆分。请保存全部分卷，恢复时逐个选择；每卷都可独立恢复。</Text>{plan && <Text style={s.subtitle}>共 {plan.parts.length} 卷，已导出 {nextPart} 卷{plan.skipped.length ? `；${plan.skipped.length} 道无法读取的题目未包含在备份内` : ''}。</Text>}{progress && <Text accessibilityLiveRegion="polite" style={s.subtitle}>已整理 {progress.completed} / {progress.total} 道题</Text>}{message && <Notice text={message} error={error} />}<View style={{ gap: 12 }}><Button title={title} disabled={running || complete} onPress={() => void start()} />{running ? <Button title="取消导出" secondary onPress={() => controller.current?.abort()} /> : null}</View></ScrollView></SafeAreaView></Modal>;
}
