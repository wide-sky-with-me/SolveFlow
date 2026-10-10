import { useState } from 'react';
import type { LocalEngine } from '@solveflow/client/local';
import { Text, View } from '../theme/primitives';
import { Button, Notice, s } from './ui';

export function PendingSaves({ engine, count, onSaved }: { engine: LocalEngine; count: number; onSaved: () => void }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function retry() {
    if (saving) return; setSaving(true); setError('');
    try { await engine.retryPendingSaves(); onSaved(); }
    catch { setError('仍未能保存。请释放存储空间后重试，当前不会再次调用模型。'); }
    finally { setSaving(false); }
  }
  return <View style={{ padding: 12, gap: 8 }}>
    <Text accessibilityLiveRegion="polite" style={s.label}>{count} 个结果尚未保存</Text>
    <Text style={s.subtitle}>解题已停止。请保持应用打开，释放空间后重试保存；关闭应用可能丢失这些结果。</Text>
    {error ? <Notice error text={error} /> : null}
    <Button title={saving ? '正在保存…' : '重试保存结果'} disabled={saving} onPress={() => void retry()} />
  </View>;
}
