import { Select } from '@solveflow/web-ui/select';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ExamTemplateCreateSchema } from '@solveflow/contracts/managed-exam';
import { api, idResponse, post } from './api.js';
import { Dialog, ErrorText } from './components.js';
type Entry = z.infer<typeof ExamTemplateCreateSchema>;
const calculatorLabels = { required: '需计算器', allowed: '可用计算器', forbidden: '无计算器', unspecified: '按科目规则' };
export function CatalogPicker({ onClose }: { onClose: () => void }) {
    const [entries, setEntries] = useState<Entry[]>([]), [code, setCode] = useState(''), [science, setScience] = useState(false), [writing, setWriting] = useState(false), [subjects, setSubjects] = useState<string[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => { const controller = new AbortController(); void api('/admin/exam-catalog', z.array(ExamTemplateCreateSchema), { signal: controller.signal }).then(v => { setEntries(v); setCode(v[0]?.code ?? ''); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取失败。'); }); return () => controller.abort(); }, []);
    const entry = entries.find(e => e.code === code);
    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault(); if (busy || !entry) return;
        setBusy(true); setError('');
        try { await api('/admin/exam-catalog', idResponse, post({ code, science, writing, esatSubjects: subjects })); onClose(); }
        catch (e) { setError(e instanceof Error ? e.message : '保存失败。'); }
        finally { setBusy(false); }
    }
    return <Dialog title="选择考试模板" onClose={() => { if (!busy) onClose(); }}><form onSubmit={e => void save(e)}><Select label="考试及版本" value={code} disabled={busy} options={entries.map(e => ({ value: e.code, label: e.title, group: e.exam.toUpperCase() }))} onChange={v => { setCode(v); setScience(false); setWriting(false); setSubjects([]); }}/>
      {entry?.exam === 'act' && <fieldset><legend>选考部分</legend>{code === 'act-enhanced' && <label className="check-label"><input type="checkbox" disabled={busy} checked={science} onChange={e => setScience(e.target.checked)}/>Science · 40题 / 40分钟</label>}<label className="check-label"><input type="checkbox" disabled={busy} checked={writing} onChange={e => setWriting(e.target.checked)}/>Writing · 1题 / 40分钟</label></fieldset>}
      {code === 'esat' && <fieldset><legend>Mathematics 1 必考 · 其他科目按报考要求选择</legend>{[['biology', 'Biology'], ['chemistry', 'Chemistry'], ['physics', 'Physics'], ['math-2', 'Mathematics 2']].map(([value, title]) => value && <label key={value} className="check-label"><input type="checkbox" disabled={busy} checked={subjects.includes(value)} onChange={e => setSubjects(e.target.checked ? [...subjects, value] : subjects.filter(s => s !== value))}/>{title}</label>)}<label className="check-label"><input type="checkbox" required disabled={busy}/>已核对该场考试的选科要求</label></fieldset>}
      {entry && <><div className="table-wrap"><table><thead><tr><th>模块</th><th>题数</th><th>分钟</th><th>规则</th></tr></thead><tbody>{entry.modules.map(m => <tr key={m.code}><td>{m.title}</td><td>{m.questionCount}</td><td>{m.durationSeconds ? m.durationSeconds / 60 : '—'}</td><td>{m.promptChoices ? m.promptChoices + '选1 · ' : ''}{m.wordLimit ? m.wordLimit + '词 · ' : ''}{calculatorLabels[m.calculator]}</td></tr>)}{code === 'esat' && subjects.map(s => <tr key={s}><td>{s}</td><td>27</td><td>40</td><td>无计算器</td></tr>)}{science && <tr><td>Science</td><td>40</td><td>40</td><td>无计算器</td></tr>}{writing && <tr><td>Writing</td><td>1</td><td>40</td><td>写作</td></tr>}</tbody></table></div><details><summary>规则来源 · {entry.reference?.edition}</summary>{entry.reference?.sources.map(url => <p key={url}><a href={url} target="_blank" rel="noreferrer">官方考试说明 ↗</a></p>)}<p>核对日期：{entry.reference?.checkedOn}</p></details></>}
      <ErrorText error={error}/><div className="dialog-footer"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={busy || !entry}>{busy ? '保存中…' : '添加模板'}</button></div></form></Dialog>;
}
