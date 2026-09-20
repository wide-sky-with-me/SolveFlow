import { useState } from 'react';
import { Modal } from 'react-native';
import { View, Text, Pressable } from '../theme/primitives';
import { useTheme } from '../theme/provider';
import { type ThemeMode } from '../theme/palette';
import { Button, Card, Notice, s } from './ui';
const choices: Array<{ value: ThemeMode; title: string }> = [{ value: 'system', title: '跟随系统' }, { value: 'light', title: '亮色' }, { value: 'dark', title: '暗色' }];
export function AppearanceSetting() {
  const { mode, setMode, error: readError } = useTheme(); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function choose(value: ThemeMode) { if (busy) return; setBusy(true); setError(''); try { await setMode(value); } catch { setError('外观设置未能保存，请重试。'); } finally { setBusy(false); } }
  return <><Pressable accessibilityRole="button" accessibilityLabel="外观" onPress={() => setOpen(true)} style={{ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={[s.label, { flex: 1 }]}>外观</Text><Text style={s.subtitle}>{choices.find(c => c.value === mode)?.title} ›</Text></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={{ flex: 1, padding: 24, backgroundColor: '#17233866', justifyContent: 'center' }}><Card><Text accessibilityRole="header" style={s.title}>外观</Text>{choices.map(choice => <Pressable key={choice.value} accessibilityRole="radio" accessibilityLabel={choice.title} accessibilityState={{ checked: mode === choice.value, disabled: busy }} aria-checked={mode === choice.value} disabled={busy} onPress={() => void choose(choice.value)} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center' }}><Text style={[s.label, { flex: 1 }]}>{choice.title}</Text><Text style={s.link}>{mode === choice.value ? '✓' : ''}</Text></Pressable>)}{(error || readError) && <Notice text={error || readError} error />}<Button title="完成" secondary onPress={() => setOpen(false)} /></Card></View></Modal></>;
}
