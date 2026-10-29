import { useState } from 'react';
import type { BatchPrintSnapshot } from '@solveflow/contracts/local';
import { Button } from './ui';
import { PdfPicker } from './pdf-picker.web';

export function BatchExportOrder({ snapshot, value, busy, onChange }: { snapshot: BatchPrintSnapshot; value: string[] | null; busy: boolean; onChange: (value: string[] | null) => void }) {
  const original = snapshot.records.map(record => record.session.id); const order = value ?? original;
  const [open, setOpen] = useState(false); const [selected, setSelected] = useState(original[0] ?? ''); const [destination, setDestination] = useState('1');
  const number = /^\d{1,3}$/.test(destination) ? Number(destination) : 0;
  const valid = number >= 1 && number <= order.length;
  const positions = new Map(snapshot.records.map(record => [record.session.id, record.batch?.position]));
  function move() {
    const index = order.indexOf(selected); if (!valid || index < 0) return;
    const next = [...order]; next.splice(index, 1); next.splice(number - 1, 0, selected); onChange(next);
  }
  return <details className="pdf-disclosure" onToggle={event => setOpen(event.currentTarget.open)}><summary>调整导出顺序（可选）</summary>{open && <div className="pdf-disclosure-content">
    <div className="pdf-mode-switch" role="group" aria-label="导出顺序"><Button title="按批次顺序" compact selected={!value} secondary={!!value} disabled={busy} onPress={() => onChange(null)} /><Button title="自定义顺序" compact selected={!!value} secondary={!value} disabled={busy} onPress={() => onChange([...order])} /></div>
    {value && <><div className="pdf-form-grid" style={{ marginTop: 12 }}><PdfPicker label="移动的题图" value={selected} disabled={busy} onChange={setSelected} options={order.map((id, index) => ({ value: id, label: `当前第 ${index + 1} 张 · 原第 ${positions.get(id)} 张` }))} /><label className="pdf-field">移动到第几张<input aria-label="导出题图目标位置" type="text" inputMode="numeric" maxLength={3} disabled={busy} value={destination} aria-invalid={!valid} onChange={event => setDestination(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); move(); } }} /></label></div>
      <div className="pdf-actions"><Button title="移动题图" compact disabled={busy || !valid} onPress={move} /></div>
      <ol aria-label="导出题图顺序" style={{ maxHeight: 220, overflowY: 'auto', paddingLeft: 28 }}>{order.map(id => <li key={id} data-record-id={id} style={{ padding: '5px 0' }}>原第 {positions.get(id)} 张题图</li>)}</ol>
      <p className="pdf-note">仅改变本次导出，同图多题保持一组；批次中的顺序不变。</p>
    </>}
  </div>}</details>;
}
