import { useRef, useState } from 'react';
import { ExamTypeSchema, EXAM_LABELS, type ExamType } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import { Text, View } from '../theme/primitives';
import { MotionModal } from './motion-modal';
import { DialogSurface } from './dialog-surface';
import { Button, Notice, s } from './ui';

export function ExamPicker({ runtime, onClose }: { runtime: Runtime; onClose: () => void }) {
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function select(exam: ExamType) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try { await runtime.saveDefaultExam(exam); onClose(); }
    catch (cause) { setError(clientError(cause)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <MotionModal visible transparent animationType="fade" onRequestClose={() => { if (!saving.current) onClose(); }}>
    <DialogSurface>
      <Text accessibilityRole="header" style={s.title}>选择默认考试</Text>
      <View style={s.row}>{ExamTypeSchema.options.map(exam => <Button key={exam} title={EXAM_LABELS[exam]} compact selected={runtime.defaultExam === exam} secondary={runtime.defaultExam !== exam} disabled={busy} onPress={() => void select(exam)} />)}</View>
      {error && <Notice text={error} error />}
      <Button title="取消" secondary disabled={busy} onPress={onClose} />
    </DialogSurface>
  </MotionModal>;
}
