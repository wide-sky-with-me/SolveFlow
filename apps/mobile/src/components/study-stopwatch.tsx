// Decision: .agents/notes/implemented/architecture/2026-10-09-overall-study-timer.md
// Decision: .agents/notes/implemented/architecture/2026-10-08-answer-checkpoint-queues.md
import { useEffect, useState, type ReactNode } from 'react';
import type { LocalStudyTimer } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import { clientError } from '@solveflow/client/presentation';
import { Pressable, Text, View } from '../theme/primitives';
import { Notice, colors } from './ui';

function TimerControl({ label, children, disabled, primary = false, onPress }: { label: string; children: ReactNode; disabled: boolean; primary?: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => ({ minWidth: primary ? 64 : 44, height: 44, paddingHorizontal: primary ? 12 : 8, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: focused ? '#7ba7f0' : 'transparent',
      backgroundColor: pressed && !disabled ? '#deebff' : primary ? '#edf3ff' : 'transparent', opacity: disabled ? .35 : 1 })}>
    {children}
  </Pressable>;
}

export function studyElapsed(timer: LocalStudyTimer, now = Date.now()) {
  return Math.min(Number.MAX_SAFE_INTEGER, timer.elapsedMs + (timer.startedAt ? Math.max(0, now - Date.parse(timer.startedAt)) : 0));
}
export function StudyStopwatch({ runtime }: { runtime: Runtime }) {
  const [timer, setTimer] = useState<LocalStudyTimer>({ schemaVersion: 1, elapsedMs: 0, startedAt: null });
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let alive = true; setReady(false); setError(''); setTimer({ schemaVersion: 1, elapsedMs: 0, startedAt: null });
    void runtime.repository.readOverallStudyTimer().then(value => { if (alive) { setTimer(value); setNow(Date.now()); setReady(true); } }).catch(cause => { if (alive) setError(clientError(cause)); });
    return () => { alive = false; };
  }, [runtime]);
  useEffect(() => { if (!timer.startedAt) return; const handle = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(handle); }, [timer.startedAt]);
  async function change(reset = false) {
    if ((!ready && !reset) || busy) return;
    setBusy(true); setError(''); const current = Date.now();
    const value: LocalStudyTimer = { schemaVersion: 1, elapsedMs: reset ? 0 : studyElapsed(timer, current), startedAt: reset || timer.startedAt ? null : new Date(current).toISOString() };
    try { await runtime.repository.saveOverallStudyTimer(value); setTimer(value); setNow(current); setReady(true); }
    catch (cause) { setError(clientError(cause)); }
    finally { setBusy(false); }
  }
  const seconds = Math.floor(studyElapsed(timer, now) / 1000);
  const stamp = `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  return <View style={{ gap: 4, alignSelf: 'center', maxWidth: '100%' }} testID="study-stopwatch"><View testID="stopwatch-controls" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 4, paddingLeft: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: '#f7f9fc' }}>
    <View style={{ minWidth: 102, gap: 1, paddingRight: 6 }}>
      <Text style={{ fontSize: 11, lineHeight: 14, color: colors.muted, includeFontPadding: false }}>整体用时</Text>
      <Text testID="stopwatch-time" accessibilityLabel="整体做题用时" style={{ fontSize: 20, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'], color: colors.ink, includeFontPadding: false }}>{stamp}</Text>
    </View>
    <TimerControl label={timer.startedAt ? '停止计时' : seconds ? '继续计时' : '开始计时'} primary disabled={!ready || busy} onPress={() => void change()}>
      <Text style={{ fontSize: 13, lineHeight: 20, fontWeight: '600', color: colors.blue, includeFontPadding: false }}>{timer.startedAt ? '暂停' : seconds ? '继续' : '开始'}</Text>
    </TimerControl>
    <TimerControl label="重置计时" disabled={busy || !error && (!ready || !seconds && !timer.startedAt)} onPress={() => void change(true)}>
      <Text accessible={false} style={{ fontSize: 24, lineHeight: 28, color: colors.muted, includeFontPadding: false }}>↻</Text>
    </TimerControl>
  </View>{error && <Notice text={error} error />}</View>;
}
