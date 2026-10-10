// Decision: .agents/notes/implemented/architecture/2026-10-09-overall-study-timer.md
// Decision: .agents/notes/implemented/architecture/2026-10-08-answer-checkpoint-queues.md
import { useEffect, useState } from 'react';
import type { LocalStudyTimer } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import { clientError } from '@solveflow/client/presentation';
import { Text, View } from '../theme/primitives';
import { Button, Notice, s } from './ui';

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
  return <View style={{ gap: 4 }} testID="study-stopwatch"><View style={[s.row, { justifyContent: 'center', gap: 6 }]}>
    <Text style={[s.subtitle, { fontSize: 13, fontVariant: ['tabular-nums'] }]} accessibilityLabel="整体做题用时">整体用时 <Text style={{ fontWeight: '600' }}>{stamp}</Text></Text>
    <Button title={timer.startedAt ? '停止计时' : seconds ? '继续计时' : '开始计时'} compact secondary disabled={!ready || busy} onPress={() => void change()} />
    <Button title="重置计时" compact secondary disabled={busy || !error && (!ready || !seconds && !timer.startedAt)} onPress={() => void change(true)} />
  </View>{error && <Notice text={error} error />}</View>;
}
