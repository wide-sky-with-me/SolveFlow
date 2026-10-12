import { useState } from 'react';
// Decision: .agents/notes/implemented/architecture/2026-10-10-web-model-presets.md
import { View, Text, TextInput, ScrollView } from '../theme/primitives';
import type { WebModelPreset } from '@solveflow/contracts/local';
import { MotionModal } from './motion-modal';
import { Button, Card, Notice, s } from './ui';

export function ModelPresets({ presets, selectedId, disabled, onLoad, onCreate, onActivate, onRemove }: {
  presets: WebModelPreset[]; selectedId?: string | undefined; disabled: boolean;
  onLoad: (preset: WebModelPreset) => void;
  onCreate: (name: string) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [dialog, setDialog] = useState<'list' | 'create' | null>(null);
  const [name, setName] = useState(''); const [error, setError] = useState('');
  const [removing, setRemoving] = useState<WebModelPreset | null>(null);
  const selected = presets.find(preset => preset.id === selectedId);
  const close = () => { if (!disabled) { setDialog(null); setRemoving(null); setError(''); } };
  async function perform(operation: () => Promise<void>, done: () => void) {
    setError('');
    try { await operation(); done(); }
    catch (cause) { setError(cause instanceof Error && cause.name !== 'ZodError' ? cause.message : '配置无效，请检查名称、模型和密钥。'); }
  }
  return <>
    <Card label="配置预设">
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <View style={s.row}><Text style={s.label}>配置预设</Text><Button title={selected?.name ?? '选择预设'} secondary compact disabled={disabled} onPress={() => { setDialog('list'); setError(''); }} /></View>
        <View style={s.row}>
          {selected && <Button title="启用预设" compact disabled={disabled} onPress={() => { setDialog('list'); void perform(() => onActivate(selected.id), close); }} />}
          <Button title="另存为预设" secondary compact disabled={disabled} onPress={() => { setName(''); setDialog('create'); setError(''); }} />
        </View>
      </View>
    </Card>
    {dialog && <MotionModal transparent animationType="fade" onRequestClose={close}>
      <View style={[s.dialogContainer, { backgroundColor: '#0006' }]}>
        <Card label={dialog === 'create' ? '另存为预设' : '选择配置预设'} style={{ width: '100%', maxWidth: 600, maxHeight: '90%' }}>
          <Text accessibilityRole="header" style={s.title}>{removing ? `移除“${removing.name}”？` : dialog === 'create' ? '另存为预设' : '配置预设'}</Text>
          {removing ? <View style={s.row}>
            <Button title="取消移除" secondary disabled={disabled} onPress={() => { setRemoving(null); setError(''); }} />
            <Button title="确认移除" danger disabled={disabled} onPress={() => void perform(() => onRemove(removing.id), () => setRemoving(null))} />
          </View> : dialog === 'create' ? <>
            <TextInput accessibilityLabel="预设名称" value={name} onChangeText={setName} editable={!disabled} maxLength={40} autoFocus style={[s.input, { minHeight: 48 }]} />
            <Button title="保存预设" disabled={disabled || !name.trim()} onPress={() => void perform(() => onCreate(name.trim()), () => { setDialog(null); setName(''); })} />
          </> : <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10 }}>
            {presets.map(preset => <Card key={preset.id} label={preset.name}>
              <Text style={s.label}>{preset.name}</Text>
              <View style={s.row}>
                <Button title="载入" secondary compact disabled={disabled} onPress={() => { onLoad(preset); setDialog(null); }} />
                <Button title="启用" compact disabled={disabled} onPress={() => void perform(() => onActivate(preset.id), () => setDialog(null))} />
                <Button title="移除" secondary danger compact disabled={disabled} onPress={() => { setRemoving(preset); setError(''); }} />
              </View>
            </Card>)}
            {!presets.length && <Button title="新增预设" secondary disabled={disabled} onPress={() => { setName(''); setDialog('create'); }} />}
          </ScrollView>}
          {error && <Notice text={error} error />}
          <Button title="关闭预设" secondary disabled={disabled} onPress={close} />
        </Card>
      </View>
    </MotionModal>}
  </>;
}
