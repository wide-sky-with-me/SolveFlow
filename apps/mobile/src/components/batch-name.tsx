import { DialogSurface } from './dialog-surface';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { MotionModal as Modal } from './motion-modal';
import { LocalBatchSchema } from '@solveflow/contracts/local';
import { Text, TextInput, View } from '../theme/primitives';
import { Button, Notice, s } from './ui';
export function BatchName({ title, onSave, onClose }: { title: string; onSave: (value: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(title); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save() { if (busy) return; const parsed = LocalBatchSchema.shape.title.safeParse(value); if (!parsed.success) { setError('请输入1～100字的批次名称。'); return; } setBusy(true); try { await onSave(parsed.data); onClose(); } catch { setError('名称未能保存，请重试。'); } finally { setBusy(false); } }
  return <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}><DialogSurface>
    <Text accessibilityRole="header" style={s.title}>批次名称</Text><TextInput accessibilityLabel="批次名称" autoFocus selectTextOnFocus value={value} onChangeText={setValue} maxLength={100} editable={!busy} returnKeyType="done" onSubmitEditing={() => void save()} style={[s.input, { minHeight: 44, height: 44, textAlignVertical: 'center' }]} />
    {error && <Notice text={error} error />}<View style={s.row}><Button title="取消" secondary disabled={busy} onPress={onClose} /><Button title="保存名称" disabled={busy || !value.trim()} onPress={() => void save()} /></View>
  </DialogSurface></KeyboardAvoidingView></Modal>;
}
