import { ScrollView, Text, TextInput, View, SafeAreaView, Pressable } from '../theme/primitives';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Switch } from 'react-native';
import { MotionModal as Modal } from './motion-modal';
import { PageHeader } from './page-header';

import { LocalSettingsSchema, LocalConcurrencySchema, MAX_LOCAL_CONCURRENCY, resolveThinking, EXAM_LABELS, EXAM_DESCRIPTIONS, type ExamType, type LocalModelProfile, type ThinkingControl } from '@solveflow/contracts/local';
import { testModelConnection } from '@solveflow/agent/mobile';
import { AgentErrorCodeSchema, makeSafeAgentError } from '@solveflow/contracts/agent';
import type { Runtime } from '../runtime';
import { Button, Card, Notice, colors, layout, s } from './ui';
const blank: LocalModelProfile = { provider: '', baseURL: '', model: '', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
// Decision: .agents/notes/implemented/agent/2026-10-09-non-stream-model-transport.md
// Keep the measured backup preset editable; saved user profiles retain their own choices.
const backupPreset: LocalModelProfile = { provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-6-sol', api: 'openai-responses', contextWindow: 1050000, maxTokens: 8192, maxTokensField: 'max_completion_tokens', streaming: false, thinking: { mode: 'on', effort: 'low' } };
export function Settings({ runtime, onClose, onSaved }: { runtime: Runtime; onClose: () => void; onSaved: () => void }) {
  const managed = runtime.environmentManaged;
  const [solver, setSolver] = useState(runtime.settings?.solver ?? blank); const [verifier, setVerifier] = useState(runtime.settings?.verifier ?? blank);
  const [backup, setBackup] = useState(runtime.settings?.backup ?? backupPreset); const [useBackup, setUseBackup] = useState(!!runtime.settings?.backup); const [backupKey, setBackupKey] = useState('');
  const [exam, setExam] = useState<ExamType>(runtime.settings?.exam ?? 'general');
  const defaults = LocalConcurrencySchema.parse(runtime.settings?.concurrency ?? {});
  const [solverConcurrency, setSolverConcurrency] = useState(String(defaults.solver));
  const [verifierConcurrency, setVerifierConcurrency] = useState(String(defaults.verifier));
  const [separate, setSeparate] = useState(!!runtime.settings?.verifier); const [solverKey, setSolverKey] = useState(''); const [verifierKey, setVerifierKey] = useState('');
  const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [testRole, setTestRole] = useState<'solver' | 'verifier' | 'backup' | null>(null);
  const scroll = useRef<ScrollView>(null);
  const sectionTop = useRef({ solver: 0, verifier: 0, backup: 0 });
  const active = useRef<AbortController | null>(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; void runtime.credentials().then(keys => { if (mounted.current) { setSolverKey(keys.solver); setVerifierKey(keys.verifier ?? ''); setBackupKey(keys.backup ?? ''); setReady(true); } }).catch(() => { if (mounted.current) setError('无法读取已保存的密钥。'); }); return () => { mounted.current = false; active.current?.abort(); }; }, [runtime]);
  function configuration() { return LocalSettingsSchema.parse({ schemaVersion: 1, solver, verifier: separate ? verifier : null, backup: useBackup ? backup : null, exam, concurrency: { solver: Number(solverConcurrency), verifier: Number(verifierConcurrency) } }); }
  async function save() { setBusy(true); setTestRole(null); setError(''); setMessage(''); try { if (!LocalConcurrencySchema.safeParse({ solver: Number(solverConcurrency), verifier: Number(verifierConcurrency) }).success) { setError(`答题并发和校验并发必须是1–${MAX_LOCAL_CONCURRENCY}的整数。`); return; } await runtime.saveSettings(configuration(), { solver: solverKey.trim(), verifier: separate ? verifierKey.trim() : null, backup: useBackup ? backupKey.trim() : null }); onSaved(); onClose(); } catch { if (mounted.current) setError('保存失败。请检查 HTTPS 地址、供应商标识、模型名、密钥和容量；输出上限不能超过上下文容量。'); } finally { if (mounted.current) setBusy(false); } }
  async function test(role: 'solver' | 'verifier' | 'backup') { setBusy(true); setTestRole(role); setError(''); setMessage(''); const controller = new AbortController(); active.current = controller; const timer = setTimeout(() => controller.abort(), 15000);
    try {
      // The connection helper validates this profile and key; saving validates both roles.
      await testModelConnection(role === 'solver' ? solver : role === 'verifier' ? verifier : backup, role === 'solver' ? solverKey : role === 'verifier' ? verifierKey : backupKey, runtime.modelFetch, controller.signal);
      if (mounted.current) setMessage('文本连接测试通过。图片识别、工具调用和完整解题还需用题目验证。');
    }
    catch (cause) {
      const code = AgentErrorCodeSchema.safeParse(cause instanceof Error && 'code' in cause ? cause.code : undefined);
      if (mounted.current) setError(code.success ? makeSafeAgentError(code.data, 'connection-test').message : '测试未通过。请检查配置、网络和协议；Web 还需要模型服务允许跨域访问。');
    }
    finally { clearTimeout(timer); active.current = null; if (mounted.current) setBusy(false); }
  }
  const connectionFeedback = (role: 'solver' | 'verifier' | 'backup') => testRole === role && (error || message)
    ? <View onLayout={event => scroll.current?.scrollTo({ y: Math.max(0, sectionTop.current[role] + event.nativeEvent.layout.y - 12), animated: false })}><Notice text={error || message} error={!!error} /></View>
    : null;
  const content = <SafeAreaView testID="settings-page" style={{ flex: 1, backgroundColor: colors.background }}>
      <PageHeader title="设置" onBack={onClose} disabled={busy} maxWidth={layout.workspaceWidth} />
      <ScrollView testID="settings-scroll" ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={{ gap: 12 }}>{managed && <Notice text="模型配置来自本地 .env。修改模型或密钥后重启 Web 服务并刷新；考试类型和并发仍可在这里保存。" />}
        <Text style={s.subtitle}>使用你配置的模型服务。解题时题图和必要的同题上下文会发送给该服务，历史记录保存在本机。</Text></View>
        <Card label="默认考试类型">
          <Text accessibilityRole="header" style={styles.sectionTitle}>默认考试类型</Text>
          <View style={[s.row, { gap: 8 }]}>{(['sat', 'act', 'ap', 'esat', 'tmua', 'tara', 'general'] as const).map(value => <Button key={value} title={EXAM_LABELS[value]} compact selected={exam === value} secondary={exam !== value} disabled={busy} onPress={() => setExam(value)} />)}</View>
          <Text style={s.subtitle} accessibilityLiveRegion="polite">{EXAM_DESCRIPTIONS[exam]}</Text>
          <Text style={s.subtitle}>仅对新题生效，历史题目保留原考试类型。</Text>
        </Card>
        <Card label="批量答题与校验并发">
          <Text accessibilityRole="header" style={styles.sectionTitle}>批量答题与校验并发</Text>
          <View style={s.row}>{([
            ['答题并发', solverConcurrency, setSolverConcurrency],
            ['校验并发', verifierConcurrency, setVerifierConcurrency],
          ] as const).map(([label, value, change]) => <View key={label} style={{ flex: 1, minWidth: 120, gap: 5 }}>
            <Text style={s.label}>{label}</Text>
            <TextInput accessibilityLabel={label} value={value} onChangeText={change} keyboardType="number-pad" editable={!busy && ready} maxLength={2} style={s.input} />
          </View>)}</View>
          <Text style={s.subtitle}>每组1–{MAX_LOCAL_CONCURRENCY}路，后续批量任务生效；遇到限流可调低。</Text>
        </Card>
        <View testID="settings-solver" onLayout={event => { sectionTop.current.solver = event.nativeEvent.layout.y; }}>
          <Card label="解题模型">
            <Text accessibilityRole="header" style={styles.sectionTitle}>解题模型</Text>
            <Profile value={solver} onChange={setSolver} apiKey={solverKey} onKey={setSolverKey} label="解题" managed={managed} disabled={busy || !ready || managed} />
            <Button title="测试解题模型连接" secondary disabled={busy || !ready || !solverKey} onPress={() => void test('solver')} />
            {testRole === 'solver' && busy && <Text accessibilityLiveRegion="polite" style={s.subtitle}>正在测试解题模型连接…</Text>}
            {connectionFeedback('solver')}
          </Card>
        </View>
        <View testID="settings-verifier" onLayout={event => { sectionTop.current.verifier = event.nativeEvent.layout.y; }}>
          <Card label="校验模型">
            <Text accessibilityRole="header" style={styles.sectionTitle}>校验模型</Text>
            <View style={styles.switchRow}>
              <Switch accessibilityLabel="使用独立校验模型" value={separate} disabled={busy || managed} onValueChange={setSeparate} />
              <Text style={[s.label, styles.switchLabel]}>单独配置校验模型</Text>
            </View>
            {!separate && <Text style={s.subtitle}>沿用解题模型。</Text>}
            {separate && <>
              <Button title="使用 GPT-6 Sol 预设" compact secondary disabled={busy || managed} onPress={() => setVerifier(backupPreset)} />
              <Profile value={verifier} onChange={setVerifier} apiKey={verifierKey} onKey={setVerifierKey} label="校验" managed={managed} disabled={busy || !ready || managed} />
              <Button title="测试校验模型连接" secondary disabled={busy || !ready || !verifierKey} onPress={() => void test('verifier')} />
              {testRole === 'verifier' && busy && <Text accessibilityLiveRegion="polite" style={s.subtitle}>正在测试校验模型连接…</Text>}
              {connectionFeedback('verifier')}
            </>}
          </Card>
        </View>
        <View testID="settings-backup" onLayout={event => { sectionTop.current.backup = event.nativeEvent.layout.y; }}>
          <Card label="备用解题模型">
            <View testID="settings-backup-summary" style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>备用解题模型</Text>
            <View style={styles.switchRow}><Switch accessibilityLabel="启用备用解题模型" value={useBackup} disabled={busy || managed} onValueChange={setUseBackup} /><Text style={[s.label, styles.switchLabel]}>失败后使用备用模型</Text></View>
            <Text style={s.subtitle}>启用后，答题失败或校验判错时自动接手一次；同题材料会发送给备用服务，可能增加调用费用。</Text>
            </View>
            {useBackup && <View testID="settings-backup-fields" style={{ gap: 12 }}>
              <Profile value={backup} onChange={setBackup} apiKey={backupKey} onKey={setBackupKey} label="备用" managed={managed} disabled={busy || !ready || managed} />
              <Button title="测试备用模型连接" secondary disabled={busy || !ready || !backupKey} onPress={() => void test('backup')} />
              {testRole === 'backup' && busy && <Text accessibilityLiveRegion="polite" style={s.subtitle}>正在测试备用模型连接…</Text>}
              {connectionFeedback('backup')}
            </View>}
          </Card>
        </View>
        <Text style={s.subtitle}>模型需支持图片和工具调用；连接测试可能产生少量费用。</Text>
        <Text style={s.subtitle}>{managed ? '模型密钥由本地 .env 管理，不保存在浏览器。题目仍保存在当前浏览器。' : Platform.OS === 'web' ? 'Web 密钥只在本页内存保留，刷新后需重新输入。题目保存在当前浏览器。' : '密钥保存在系统安全存储，题图和对话保存在本机数据库。卸载或清除应用数据会丢失记录。'}</Text>
        {testRole === null && error ? <Notice text={error} error /> : null}
        {testRole === null && message ? <Notice text={message} /> : null}
        <Button title={busy ? '正在处理…' : '保存设置'} disabled={busy || !ready} onPress={() => void save()} />
        <Button title="清除已保存密钥" danger secondary disabled={busy || !ready || managed} onPress={() => { setBusy(true); setTestRole(null); setError(''); setMessage(''); void runtime.clearKeys().then(() => { setSolverKey(''); setVerifierKey(''); setBackupKey(''); onSaved(); setMessage('密钥已清除，题目记录保留。'); }).catch(() => setError('清除密钥失败。')).finally(() => { if (mounted.current) setBusy(false); }); }} />
      </ScrollView>
    </SafeAreaView>;
  return <Modal animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    {Platform.OS === 'ios'
      ? <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>{content}</KeyboardAvoidingView>
      : content}
  </Modal>;
}
/** Writes the two-level control and drops the legacy single-select field. */
function applyThinking(value: LocalModelProfile, thinking: ThinkingControl): LocalModelProfile {
  const { thinkingControl: _legacy, ...rest } = value;
  return { ...rest, thinking };
}
function Profile({ value, onChange, apiKey, onKey, label, disabled, managed = false }: { value: LocalModelProfile; onChange: (value: LocalModelProfile) => void; apiKey: string; onKey: (value: string) => void; label: string; disabled: boolean; managed?: boolean }) {
  const [advanced, setAdvanced] = useState(false);
  const field = (name: string, current: string, change: (text: string) => void, secret = false, numeric = false) => <View style={{ gap: 5 }}>
    <Text style={s.label}>{name}</Text>
    <TextInput accessibilityLabel={`${label}${name}`} value={current} onChangeText={change} editable={!disabled} autoCapitalize="none" autoCorrect={false} secureTextEntry={secret} keyboardType={numeric ? 'number-pad' : 'default'} maxLength={secret ? 2048 : numeric ? 8 : 256} style={[s.input, { minHeight: 48 }]} />
  </View>;
  const thinking = resolveThinking(value);
  return <View style={{ gap: 12 }}>
    {field('服务地址', value.baseURL, baseURL => onChange({ ...value, baseURL }))}
    {field('供应商标识', value.provider, provider => onChange({ ...value, provider }))}
    {field('模型引用名', value.model, model => onChange({ ...value, model }))}
    {!managed && field('API Key', apiKey, onKey, true)}
    <Text style={s.label}>接口协议</Text>
    <View style={[s.row, { gap: 8 }]}>{([['openai-completions', 'Chat Completions'], ['openai-responses', 'Responses']] as const).map(([api, title]) => <Button key={api} title={title} compact selected={value.api === api} secondary={value.api !== api} disabled={disabled} onPress={() => onChange({ ...value, api })} />)}</View>
    <Text style={s.label}>深度思考</Text>
    <View style={[s.row, { gap: 8 }]}>{([
      ['provider-default', '服务默认'], ['off', '关闭'], ['on', '开启'],
    ] as const).map(([mode, title]) => <Button key={mode} title={title} compact selected={thinking.mode === mode} secondary={thinking.mode !== mode} disabled={disabled} onPress={() => onChange(applyThinking(value, { ...thinking, mode }))} />)}</View>
    {thinking.mode === 'on' && <View style={{ gap: 12 }}>
      <Text style={s.label}>思考强度</Text>
      <View style={[s.row, { gap: 8 }]}>{([['low', '低'], ['medium', '中'], ['high', '高']] as const).map(([effort, title]) => <Button key={effort} title={title} compact selected={(thinking.effort ?? 'medium') === effort} secondary={(thinking.effort ?? 'medium') !== effort} disabled={disabled} onPress={() => onChange(applyThinking(value, { ...thinking, effort }))} />)}</View>
    </View>}
    <View style={styles.advanced}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}高级参数`} accessibilityState={{ expanded: advanced, disabled }} aria-expanded={advanced} disabled={disabled} onPress={() => setAdvanced(open => !open)} style={styles.advancedToggle}>
        <Text style={s.label}>高级参数</Text><Text style={s.link}>{advanced ? '收起' : '展开'}</Text>
      </Pressable>
      {advanced && <View style={{ gap: 12 }}>
        <Text style={s.label}>响应方式</Text>
        <View style={[s.row, { gap: 8 }]}>{([false, true] as const).map(streaming => <Button key={String(streaming)} title={streaming ? '流式' : '非流式'} compact selected={(value.streaming ?? label === '解题') === streaming} secondary={(value.streaming ?? label === '解题') !== streaming} disabled={disabled} onPress={() => onChange({ ...value, streaming })} />)}</View>
        <Text style={s.subtitle}>服务地址填写 API Base URL（含服务要求的路径，如 /v1），无需填写 /chat/completions 或 /responses；接口协议按服务文档选择。</Text>
        {value.api === 'openai-responses' && <Text style={s.subtitle}>Responses 使用 reasoning.effort 控制思考。部分模型不支持关闭，请使用服务默认或开启后选择强度。</Text>}
        {field('上下文容量', String(value.contextWindow || ''), text => onChange({ ...value, contextWindow: Number(text) }), false, true)}
        {field('最大输出 tokens', String(value.maxTokens || ''), text => onChange({ ...value, maxTokens: Number(text) }), false, true)}
        {thinking.mode !== 'provider-default' && value.api === 'openai-completions' && <View style={{ gap: 12 }}>
          <Text style={s.label}>思考参数协议</Text>
          <View style={[s.row, { gap: 8 }]}>{([['thinking-type', 'thinking.type'], ['enable-thinking', 'enable_thinking'], ['reasoning-effort', 'reasoning_effort']] as const).map(([protocol, title]) => <Button key={protocol} title={title} compact selected={(thinking.protocol ?? 'thinking-type') === protocol} secondary={(thinking.protocol ?? 'thinking-type') !== protocol} disabled={disabled} onPress={() => onChange(applyThinking(value, { ...thinking, protocol }))} />)}</View>
          <Text style={s.subtitle}>按服务文档选择参数名。DeepSeek 用 thinking.type，Qwen 用 enable_thinking，OpenAI 兼容用 reasoning_effort；不支持时报错，不自动换模型。强度按协议映射（thinking.type：低/中/高 → low/high/max）。</Text>
        </View>}
        {value.api === 'openai-completions' && <View style={styles.switchRow}>
          <Switch accessibilityLabel={`${label}使用max_completion_tokens`} value={value.maxTokensField === 'max_completion_tokens'} disabled={disabled} onValueChange={enabled => onChange({ ...value, maxTokensField: enabled ? 'max_completion_tokens' : 'max_tokens' })} />
          <Text style={[s.subtitle, styles.switchLabel]}>服务要求 max_completion_tokens</Text>
        </View>}
      </View>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center', padding: 10, paddingBottom: 24, gap: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  switchLabel: { flex: 1, minWidth: 0 },
  advanced: { borderTopWidth: 1, borderTopColor: colors.line, gap: 8, marginTop: 4 },
  advancedToggle: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
});
