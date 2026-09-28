import { useEffect, useRef, useState } from 'react';
import { Modal } from 'react-native';
import type { HistoryExportProgress, LocalRepository } from '@solveflow/client';
import { exportHistory } from '../local/export-history';
import { SafeAreaView, Text, View } from '../theme/primitives';
import { Button, Card, Notice, s } from './ui';
export function HistoryExport({ repository, onClose }: { repository: LocalRepository; onClose: () => void }) {
  const controller = useRef<AbortController | null>(null); const alive = useRef(true);
  const [running, setRunning] = useState(false); const [progress, setProgress] = useState<HistoryExportProgress | null>(null);
  const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  async function start() {
    if (controller.current) return;
    const operation = new AbortController(); controller.current = operation; setRunning(true); setMessage(''); setProgress(null); setError(false);
    try { const name = await exportHistory(repository, operation.signal, value => { if (alive.current) setProgress(value); }); if (alive.current) setMessage(name ? `已导出：${name}` : '已取消导出。'); }
    catch (cause) { if (alive.current) { setError(true); setMessage(cause instanceof Error ? cause.message : '导出失败，请重试。'); } }
    finally { controller.current = null; if (alive.current) setRunning(false); }
  }
  return <Modal visible animationType="slide" onRequestClose={() => { if (running) controller.current?.abort(); else onClose(); }}><SafeAreaView style={{ flex: 1, padding: 20 }}><Card><Text style={s.title}>导出本地记录</Text><Text style={s.subtitle}>将题图、全部解答、收藏状态和脱敏诊断保存到你选择的本机目录，不包含模型密钥或模型设置。文件含个人学习内容，请妥善保管。</Text><Text style={s.subtitle}>导出不会删除历史，也不会发送到网络。暂不支持将文件导回应用。</Text>{progress && <Text accessibilityLiveRegion="polite" style={s.subtitle}>已整理 {progress.completed} / {progress.total} 道题</Text>}{message && <Notice text={message} error={error} />}<View style={{ gap: 12 }}><Button title={running ? '正在导出…' : '导出到本机'} disabled={running} onPress={() => void start()} />{running ? <Button title="取消导出" secondary onPress={() => controller.current?.abort()} /> : <Button title="返回" secondary onPress={onClose} />}</View></Card></SafeAreaView></Modal>;
}
