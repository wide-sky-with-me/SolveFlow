import { Pressable, Text, View, SafeAreaView } from '../theme/primitives';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Modal, Platform, StyleSheet } from 'react-native';
import { useCameraPermissions } from 'expo-camera';

import { Button, Notice, s } from './ui';
import type { Photo } from '../platform.types';
import { releasePhoto } from '../platform';
import { CameraPreview } from './camera-preview';
import type { CameraHandle } from './camera-preview.types';
export function Camera({ onPhoto, onClose, onGallery, continuous = false, count = 0, limit = 100, externalBusy = false, message, batchTitle, onModeChange, onRename, children }: { onPhoto: (photo: Photo) => void | Promise<void>; onClose: () => void; onGallery: () => void; continuous?: boolean; count?: number; limit?: number; externalBusy?: boolean; message?: string; batchTitle?: string | undefined; onModeChange?: ((batch: boolean) => void) | undefined; onRename?: () => void; children?: ReactNode }) {
  const [permission, requestPermission] = useCameraPermissions(); const [active, setActive] = useState(AppState.currentState === 'active');
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [facing, setFacing] = useState<'back' | 'front'>('back');
  const camera = useRef<CameraHandle>(null); const alive = useRef(true); const capturing = useRef(false); const [attempt, setAttempt] = useState(0);
  useEffect(() => { alive.current = true; const sub = AppState.addEventListener('change', value => { setActive(value === 'active'); setReady(false); }); return () => { alive.current = false; sub.remove(); }; }, []);
  useEffect(() => { if (Platform.OS === 'android') setReady(false); }, [continuous]);
  async function capture() {
    if (!camera.current || !ready || capturing.current || externalBusy) return; capturing.current = true; setBusy(true);
    try { const photo = await camera.current.takePictureAsync(); if (alive.current) await onPhoto(photo); else releasePhoto(photo); }
    catch { if (alive.current) setError('拍摄失败，请重试或从相册选择。'); }
    finally { capturing.current = false; if (alive.current) setBusy(false); }
  }
  return <Modal animationType="slide" onRequestClose={() => { if (!busy && !externalBusy) onClose(); }}><SafeAreaView style={styles.screen}>
    <View style={styles.header}>{continuous ? <Pressable accessibilityRole="button" accessibilityLabel="重命名批次" disabled={busy || externalBusy} onPress={onRename} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}><Text numberOfLines={1} style={s.label}>{batchTitle ?? '批量解题'} <Text style={s.subtitle}>✎</Text></Text></Pressable> : <Text style={[s.label, { flex: 1 }]}>拍摄题目</Text>}<Button title={continuous ? '完成拍摄' : '关闭相机'} compact secondary disabled={busy || externalBusy} onPress={onClose} /></View>
    {message ? <Notice text={message} error /> : null}
    {error ? <View style={{ gap: 8 }}><Notice text={error} error /><Button title="重试相机" secondary onPress={() => { setError(''); setReady(false); setAttempt(value => value + 1); }} /></View> : null}
    {permission?.granted && active ? <View style={styles.preview}><CameraPreview key={`${attempt}:${facing}:${Platform.OS === 'android' ? continuous : ''}`} ref={camera} facing={facing} lockFocus={Platform.OS === 'android' && continuous} onReady={() => { if (alive.current) setReady(true); }} onError={() => { if (alive.current) { setReady(false); setError('无法打开相机，请检查权限或选择相册。'); } }} /><View pointerEvents="none" style={styles.frame} /><Text numberOfLines={1} accessibilityLiveRegion="polite" style={styles.hint}>{busy ? '拍摄中…' : continuous ? `已保存 ${count} 张${Platform.OS === 'android' ? ' · 点画面重新对焦' : ''}` : '将题目放入画面'}</Text></View>
      : <View style={styles.permission}><Text style={s.subtitle}>{active ? '允许相机权限后即可拍摄题目' : '返回应用后恢复相机'}</Text><Button title="允许使用相机" onPress={() => { void requestPermission().then(value => { if (alive.current && !value.granted) setError('未获得相机权限，可以从相册选择题图。'); }).catch(() => { if (alive.current) setError('相机授权失败，请使用相册。'); }); }} />{permission && !permission.canAskAgain && Platform.OS !== 'web' && <Button title="打开系统设置" secondary onPress={() => { void Linking.openSettings(); }} />}{Platform.OS === 'web' && <Text style={s.subtitle}>浏览器相机需要 HTTPS 或 localhost 安全地址</Text>}</View>}
    <View style={styles.modes}>{([false, true] as const).map(value => <Pressable key={String(value)} accessibilityRole="button" accessibilityLabel={value ? '批量解题' : '单题拍照'} accessibilityState={{ selected: continuous === value, disabled: busy || externalBusy || !onModeChange }} aria-pressed={continuous === value} disabled={busy || externalBusy || !onModeChange} onPress={() => onModeChange?.(value)} style={styles.mode}><Text style={[styles.modeLabel, continuous === value && styles.modeSelected]}>{value ? '批量解题' : '单题拍照'}</Text>{continuous === value && <View style={styles.dot} />}</Pressable>)}</View>
    {/* Keep the shutter width stable: a longer label can wrap the footer and resize the live preview. */}
    <View style={styles.footer}><Button title="从相册选择" secondary onPress={onGallery} disabled={busy || externalBusy || continuous && count >= limit} /><Button title="拍摄" onPress={() => void capture()} disabled={!ready || busy || externalBusy || !active || continuous && count >= limit} /><Button title="切换镜头" secondary onPress={() => { setReady(false); setFacing(value => value === 'back' ? 'front' : 'back'); }} disabled={busy || externalBusy} /></View>
    {children}
  </SafeAreaView></Modal>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#fff', padding: 16, gap: 12 }, modes: { flexDirection: 'row', justifyContent: 'center', gap: 30 }, mode: { minHeight: 44, justifyContent: 'center', alignItems: 'center', gap: 5 }, modeLabel: { fontSize: 15, color: '#6b7a90' }, modeSelected: { color: '#172338', fontWeight: '700' }, dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#2867dd' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, preview: { flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 14, backgroundColor: '#172338', justifyContent: 'center' }, frame: { height: '55%', marginHorizontal: 22, borderColor: '#fff', borderWidth: 2, borderRadius: 12 }, hint: { color: '#fff', textAlign: 'center', marginTop: 20 }, permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }, footer: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 10 } });
