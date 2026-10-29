import type { LocalHistorySummary, LocalImageEdit } from '@solveflow/contracts/local';
import { useEffect, useState } from 'react';
import type { Runtime } from '../runtime';
import type { RunView } from '@solveflow/contracts/http';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { ScrollView, Text, SafeAreaView } from '../theme/primitives';
import { MotionModal as Modal } from '../components/motion-modal';
import { DialogSurface } from '../components/dialog-surface';
import { FormulaEditor } from '../components/formula-editor';
import { CorrectionImages } from '../components/correction-images';
import { Button, Notice, s } from '../components/ui';
import { UsageGuide } from '../components/usage-guide';
import type { Correction } from './types';
import { styles } from './styles';

export function CorrectionModal({
  correction,
  busy,
  active,
  available,
  error,
  runtime,
  onClose,
  onSubmit,
  onChange,
}: {
  correction: Correction | null;
  busy: boolean;
  active: RunView | null;
  available: boolean;
  error: string;
  runtime: Runtime;
  onClose: () => void;
  onSubmit: (edit: LocalImageEdit) => void;
  onChange: (text: string) => void;
}) {
  const [imageEdit, setImageEdit] = useState<LocalImageEdit | null>(null);
  const [imagesBusy, setImagesBusy] = useState(false);
  useEffect(() => { setImageEdit(null); setImagesBusy(false); }, [correction?.run.id, correction?.number]);
  const blocked = busy || !!active || imagesBusy;
  return (
    <Modal visible={!!correction} animationType="slide" onRequestClose={() => { if (!blocked) onClose(); }}>
      <SafeAreaView style={styles.modal}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.pageContent}>
            <Text accessibilityRole="header" style={s.title}>更正题干</Text>
            {correction && <CorrectionImages key={`${correction.run.id}:${correction.number ?? 0}`} runtime={runtime} sessionId={correction.run.sessionId} disabled={busy || !!active} onChange={setImageEdit} onBusy={setImagesBusy} />}
            {correction && (
              <FormulaEditor
                key={`${correction.run.id}:${correction.number ?? 0}`}
                value={correction.text}
                onChange={onChange}
                disabled={blocked}
              />
            )}
            {error && <Notice text={error} error />}
            <Button
              title="按更正重新解答"
              disabled={blocked || !imageEdit || !correction?.text.trim() || !available}
              onPress={() => { if (imageEdit) onSubmit(imageEdit); }}
            />
            <Button title="取消更正" secondary disabled={blocked} onPress={onClose} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export function DeleteModal({
  confirmDelete,
  sessions,
  hasStorageIssues,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  confirmDelete: string | null;
  sessions: LocalHistorySummary[];
  hasStorageIssues: boolean;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const title =
    confirmDelete === 'singles' ? `清空 ${sessions.filter(row => !row.batch).length} 道单题记录？` : confirmDelete === 'all'
      ? hasStorageIssues ? '清空本机全部题目，包括无法读取的记录？' : `清空全部 ${sessions.length} 道题？`
      : confirmDelete?.startsWith('batch:')
        ? '删除这一批全部题图与解答？'
        : '删除这道题？';
  const description =
    confirmDelete === 'singles' ? `仅永久删除单题的题图、解答、收藏和诊断，批量记录保留。${hasStorageIssues ? '无法确认分类的损坏记录保留，请在记录维护中处理。' : ''}` : confirmDelete === 'all'
      ? '将永久删除本机全部历史题图、解答、收藏和诊断记录，无法撤销。进行中的任务会取消，模型设置保留。已导出的文件仍保留。'
      : '将从本机永久移除题图、解答和收藏，无法撤销；进行中的任务也会取消。';
  return (
    <Modal
      visible={!!confirmDelete}
      transparent
      animationType="fade"
      onRequestClose={() => { if (!busy) onClose(); }}
    >
      <DialogSurface>
          <Text accessibilityRole="header" style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{description}</Text>
          {error ? <Notice text={error} error /> : null}
          <Button
            title={confirmDelete === 'singles' ? '确认清空单题历史' : confirmDelete === 'all' ? '确认清空全部历史' : '确认删除'}
            danger
            disabled={busy}
            onPress={onConfirm}
          />
          <Button title="保留题目" secondary disabled={busy} onPress={onClose} />
      </DialogSurface>
    </Modal>
  );
}

export function HelpModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><UsageGuide onClose={onClose} /></Modal>;
}
