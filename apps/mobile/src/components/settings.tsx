import { ScrollView, Text, TextInput, View, SafeAreaView } from '../theme/primitives';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Switch } from 'react-native';

import { fetch } from 'expo/fetch';
import { LocalSettingsSchema, resolveThinking, EXAM_LABELS, type ExamType, type LocalModelProfile, type ThinkingControl } from '@solveflow/contracts/local';
import { testModelConnection } from '@solveflow/agent/mobile';
import type { Runtime } from '../runtime';
import { Button, Notice, s } from './ui';
const blank: LocalModelProfile = { provider: '', baseURL: '', model: '', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
export function Settings({ runtime, onClose, onSaved }: { runtime: Runtime; onClose: () => void; onSaved: () => void }) {
  const [solver, setSolver] = useState(runtime.settings?.solver ?? blank); const [verifier, setVerifier] = useState(runtime.settings?.verifier ?? blank);
  const [exam, setExam] = useState<ExamType>(runtime.settings?.exam ?? 'general');
  const [separate, setSeparate] = useState(!!runtime.settings?.verifier); const [solverKey, setSolverKey] = useState(''); const [verifierKey, setVerifierKey] = useState('');
  const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; void runtime.credentials().then(keys => { if (mounted.current) { setSolverKey(keys.solver); setVerifierKey(keys.verifier ?? ''); setReady(true); } }).catch(() => { if (mounted.current) setError('无法读取已保存的密钥。'); }); return () => { mounted.current = false; active.current?.abort(); }; }, [runtime]);
  function configuration() { return LocalSettingsSchema.parse({ schemaVersion: 1, solver, verifier: separate ? verifier : null, exam }); }
  async function save() { setBusy(true); setError(''); setMessage(''); try { await runtime.saveSettings(configuration(), { solver: solverKey.trim(), verifier: separate ? verifierKey.trim() : null }); onSaved(); onClose(); } catch { if (mounted.current) setError('保存失败。请检查 HTTPS 地址、供应商标识、模型名、密钥和容量；输出上限不能超过上下文容量。'); } finally { if (mounted.current) setBusy(false); } }
  async function test(role: 'solver' | 'verifier') { setBusy(true); setError(''); setMessage(''); const controller = new AbortController(); active.current = controller; const timer = setTimeout(() => controller.abort(), 15000);
    try { const value = configuration(); await testModelConnection(role === 'solver' ? value.solver : value.verifier ?? value.solver, role === 'solver' ? solverKey : verifierKey, fetch, controller.signal); if (mounted.current) setMessage('文本连接测试通过。图片识别、工具调用和完整解题还需用题目验证。'); }
    catch { if (mounted.current) setError('测试未通过。请检查配置、网络和协议；Web 还需要模型服务允许跨域访问。'); }
    finally { clearTimeout(timer); active.current = null; if (mounted.current) setBusy(false); }
  }
  return <Modal animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}><SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
    <Text accessibilityRole="header" style={s.title}>设置</Text><Text style={s.subtitle}>直接连接你配置的模型服务。解题时题图和必要的同题上下文会发送给该服务，历史记录保存在本机。</Text>
    <Text style={s.label}>默认考试类型</Text>
    <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>{(['sat', 'act', 'ap', 'general'] as const).map(value => <Button key={value} title={EXAM_LABELS[value]} compact selected={exam === value} secondary={exam !== value} disabled={busy} onPress={() => setExam(value)} />)}</View>
    <Text style={s.subtitle}>保存后，新拍照和上传的题目默认使用所选考试规则。可随时修改；历史题目保留原考试类型。未指定时根据原题判断。</Text>
    <Text style={s.label}>解题模型</Text><Profile value={solver} onChange={setSolver} apiKey={solverKey} onKey={setSolverKey} label="解题" disabled={busy || !ready} />
    <Button title="测试解题模型连接" secondary disabled={busy || !ready || !solverKey} onPress={() => void test('solver')} />
    <View style={s.row}><Switch accessibilityLabel="使用独立校验模型" value={separate} disabled={busy} onValueChange={setSeparate} /><Text style={s.label}>单独配置校验模型</Text></View>
    <Text style={s.subtitle}>{separate ? '校验会独立接收原题和候选答案。' : '使用同一个模型进行独立的第二次校验调用。'}</Text>
    {separate && <><Profile value={verifier} onChange={setVerifier} apiKey={verifierKey} onKey={setVerifierKey} label="校验" disabled={busy || !ready} /><Button title="测试校验模型连接" secondary disabled={busy || !ready || !verifierKey} onPress={() => void test('verifier')} /></>}
    <Text style={s.subtitle}>支持 OpenAI 兼容 Chat Completions 和 Responses 协议；解题模型需支持图片和工具调用。连接测试会发送一条简短文本，可能产生少量调用费用。</Text>
    <Text style={s.subtitle}>{Platform.OS === 'web' ? 'Web 密钥只在本页内存保留，刷新后需重新输入。题目保存在当前浏览器。' : '密钥保存在系统安全存储，题图和对话保存在本机数据库。卸载或清除应用数据会丢失记录。'}</Text>
    {error ? <Notice text={error} error /> : null}{message ? <Notice text={message} /> : null}
    <Button title={busy ? '正在处理…' : '保存设置'} disabled={busy || !ready} onPress={() => void save()} />
    <Button title="清除已保存密钥" danger secondary disabled={busy || !ready} onPress={() => { setBusy(true); void runtime.clearKeys().then(() => { setSolverKey(''); setVerifierKey(''); onSaved(); setMessage('密钥已清除，题目记录保留。'); }).catch(() => setError('清除密钥失败。')).finally(() => { if (mounted.current) setBusy(false); }); }} />
    <Button title="返回" secondary disabled={busy} onPress={onClose} />
  </ScrollView></SafeAreaView></Modal>;
}
/** Writes the two-level control and drops the legacy single-select field. */
function applyThinking(value: LocalModelProfile, thinking: ThinkingControl): LocalModelProfile {
  const { thinkingControl: _legacy, ...rest } = value;
  return { ...rest, thinking };
}
function Profile({ value, onChange, apiKey, onKey, label, disabled }: { value: LocalModelProfile; onChange: (value: LocalModelProfile) => void; apiKey: string; onKey: (value: string) => void; label: string; disabled: boolean }) {
  const field = (name: string, current: string, change: (text: string) => void, secret = false, numeric = false) => <View style={{ gap: 5 }}><Text style={s.label}>{name}</Text><TextInput accessibilityLabel={`${label}${name}`} value={current} onChangeText={change} editable={!disabled} autoCapitalize="none" autoCorrect={false} secureTextEntry={secret} keyboardType={numeric ? 'number-pad' : 'default'} maxLength={secret ? 2048 : 2048} style={[s.input, { minHeight: 48 }]} /></View>;
  const thinking = resolveThinking(value);
  return <View style={{ gap: 12 }}>{field('服务地址', value.baseURL, baseURL => onChange({ ...value, baseURL }))}<Text style={s.subtitle}>填写服务文档中的 API Base URL，包含其要求的路径（如 /v1），不用填写 /chat/completions 或 /responses。</Text>
    {field('供应商标识', value.provider, provider => onChange({ ...value, provider }))}{field('模型引用名', value.model, model => onChange({ ...value, model }))}{field('API Key', apiKey, onKey, true)}
    <Text style={s.label}>接口协议</Text><View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>{([['openai-completions', 'Chat Completions'], ['openai-responses', 'Responses']] as const).map(([api, title]) => <Button key={api} title={title} compact selected={value.api === api} secondary={value.api !== api} disabled={disabled} onPress={() => onChange({ ...value, api })} />)}</View>
    <Text style={s.subtitle}>按服务要求选择；需要 Responses 才能调用工具的模型请选择 Responses。</Text>
    {field('上下文容量', String(value.contextWindow || ''), text => onChange({ ...value, contextWindow: Number(text) }), false, true)}{field('最大输出 tokens', String(value.maxTokens || ''), text => onChange({ ...value, maxTokens: Number(text) }), false, true)}
    <Text style={s.label}>深度思考</Text>
    <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>{([
      ['provider-default', '服务默认'], ['off', '关闭'], ['on', '开启'],
    ] as const).map(([mode, title]) => <Button key={mode} title={title} compact selected={thinking.mode === mode} secondary={thinking.mode !== mode} disabled={disabled} onPress={() => onChange(applyThinking(value, { ...thinking, mode }))} />)}</View>
    {thinking.mode === 'on' && <View style={{ gap: 12 }}><Text style={s.label}>思考强度</Text>
      <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>{([['low', '低'], ['medium', '中'], ['high', '高']] as const).map(([effort, title]) => <Button key={effort} title={title} compact selected={(thinking.effort ?? 'medium') === effort} secondary={(thinking.effort ?? 'medium') !== effort} disabled={disabled} onPress={() => onChange(applyThinking(value, { ...thinking, effort }))} />)}</View></View>}
    {thinking.mode !== 'provider-default' && value.api === 'openai-completions' && <View style={{ gap: 12 }}><Text style={s.label}>思考参数协议</Text>
      <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>{([['thinking-type', 'thinking.type'], ['enable-thinking', 'enable_thinking'], ['reasoning-effort', 'reasoning_effort']] as const).map(([protocol, title]) => <Button key={protocol} title={title} compact selected={(thinking.protocol ?? 'thinking-type') === protocol} secondary={(thinking.protocol ?? 'thinking-type') !== protocol} disabled={disabled} onPress={() => onChange(applyThinking(value, { ...thinking, protocol }))} />)}</View>
      <Text style={s.subtitle}>按服务文档选择参数名。DeepSeek 用 thinking.type，Qwen 用 enable_thinking，OpenAI 兼容用 reasoning_effort；不支持时报错，不自动换模型。强度按协议映射（thinking.type：低/中/高 → low/high/max）。</Text></View>}
    {value.api === 'openai-responses' && <Text style={s.subtitle}>Responses 使用 reasoning.effort 控制思考。部分模型不支持关闭，请使用服务默认或开启后选择强度。</Text>}
    {value.api === 'openai-completions' && <View style={s.row}><Switch accessibilityLabel={`${label}使用max_completion_tokens`} value={value.maxTokensField === 'max_completion_tokens'} disabled={disabled} onValueChange={enabled => onChange({ ...value, maxTokensField: enabled ? 'max_completion_tokens' : 'max_tokens' })} /><Text style={s.subtitle}>服务要求 max_completion_tokens</Text></View>}
  </View>;
}
