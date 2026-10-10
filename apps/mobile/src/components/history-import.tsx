import { useEffect, useRef, useState } from 'react';
import { MotionModal as Modal } from './motion-modal';
import { PageHeader } from './page-header';
import type { HistoryImportProgress, LocalRepository } from '@solveflow/client/local';
import { importHistory } from '../local/import-history';
import { SafeAreaView, ScrollView, Text, View } from '../theme/primitives';
import { Button, Notice, s } from './ui';
export function HistoryImport({ repository, onClose, repairSessionId }: { repository: LocalRepository; onClose: () => void; repairSessionId?: string | undefined }) {
  const controller = useRef<AbortController | null>(null); const alive = useRef(true);
  const [running, setRunning] = useState(false); const [progress, setProgress] = useState<HistoryImportProgress | null>(null);
  const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  async function start() {
    if (controller.current) return;
    const operation = new AbortController(); controller.current = operation; setRunning(true); setMessage(''); setProgress(null); setError(false);
    try {
      const result = await importHistory(repository, operation.signal, value => { if (alive.current) setProgress(value); }, repairSessionId);
      if (alive.current) setMessage(result ? `已恢复 ${result.restored} 道题，跳过 ${result.skipped} 道已有题目。` : '已取消恢复。');
    } catch (cause) {
      if (alive.current) { setError(true); setMessage(cause instanceof Error ? cause.message : '恢复失败，请检查备份文件。'); }
    } finally { controller.current = null; if (alive.current) setRunning(false); }
  }
  return <Modal visible animationType="slide" onRequestClose={() => { if (running) controller.current?.abort(); else onClose(); }}><SafeAreaView style={{ flex: 1 }}><PageHeader title={repairSessionId ? '恢复损坏题目' : '恢复本地记录'} onBack={onClose} disabled={running} /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.pageContent}><Text style={s.subtitle}>{repairSessionId ? `将用备份替换编号末尾 ${repairSessionId.slice(-8)} 的损坏题目及其收藏状态，备份之后的改动将丢失。其他题目保留。请确认后选择包含这道题的备份分卷。` : '选择 SolveFlow 导出的 .ndjson 备份，恢复题图、解答、收藏与诊断。同一道题已在本机时保留本机记录，不覆盖。'}</Text><Text style={s.subtitle}>恢复不包含模型设置和密钥。未完成任务会标为中断，不会自动重新解题。分卷备份请逐个选择恢复。</Text>{progress && <Text accessibilityLiveRegion="polite" style={s.subtitle}>{progress.phase === 'checking' ? '已检查' : '已恢复'} {progress.completed} 道题</Text>}{message && <Notice text={message} error={error} />}<View style={{ gap: 12 }}><Button title={running ? '正在恢复…' : repairSessionId ? '确认选择备份恢复此题' : '选择备份并恢复'} disabled={running} onPress={() => void start()} />{running ? <Button title="取消恢复" secondary onPress={() => controller.current?.abort()} /> : null}</View></ScrollView></SafeAreaView></Modal>;
}
