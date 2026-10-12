import { ScrollView, Text, TextInput, View, SafeAreaView, Pressable } from '../theme/primitives';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Switch } from 'react-native';
import { MotionModal as Modal } from './motion-modal';
import { PageHeader } from './page-header';
import { ModelPresets } from './model-presets';

import { LocalSettingsSchema, LocalConcurrencySchema, MAX_LOCAL_CONCURRENCY, resolveThinking, EXAM_LABELS, type ExamType, type LocalModelProfile, type ThinkingControl, type WebModelPreset, type WebModelUpdate } from '@solveflow/contracts/local';
import { testModelConnection } from '@solveflow/agent/mobile';
import { AgentErrorCodeSchema, makeSafeAgentError } from '@solveflow/contracts/agent';
import type { Runtime } from '../runtime';
import { Button, Card, Notice, colors, layout, s } from './ui';
const blank: LocalModelProfile = { provider: '', baseURL: '', model: '', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
// Decision: .agents/notes/implemented/agent/2026-10-09-non-stream-model-transport.md
// Keep the measured backup default editable; saved user profiles retain their own choices.
const backupPreset: LocalModelProfile = { provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-6-sol', api: 'openai-responses', contextWindow: 1050000, maxTokens: 8192, maxTokensField: 'max_completion_tokens', streaming: false, thinking: { mode: 'on', effort: 'low' } };
export function Settings({ runtime, onClose, onSaved }: { runtime: Runtime; onClose: () => void; onSaved: () => void }) {
  const managed = runtime.environmentManaged;
  const editableModels = runtime.modelSettingsEditable;
  const [solver, setSolver] = useState(runtime.settings?.solver ?? blank); const [verifier, setVerifier] = useState(runtime.settings?.verifier ?? blank);
  const [backup, setBackup] = useState(runtime.settings?.backup ?? backupPreset); const [useBackup, setUseBackup] = useState(!!runtime.settings?.backup); const [backupKey, setBackupKey] = useState('');
  const [exam, setExam] = useState<ExamType>(runtime.defaultExam);
  const defaults = LocalConcurrencySchema.parse(runtime.settings?.concurrency ?? {});
  const [solverConcurrency, setSolverConcurrency] = useState(String(defaults.solver));
  const [verifierConcurrency, setVerifierConcurrency] = useState(String(defaults.verifier));
  const [separate, setSeparate] = useState(!!runtime.settings?.verifier); const [solverKey, setSolverKey] = useState(''); const [verifierKey, setVerifierKey] = useState('');
  const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [testRole, setTestRole] = useState<'solver' | 'verifier' | 'backup' | null>(null);
  const [profilesAdvanced, setProfilesAdvanced] = useState(false);
  const [credentialPresetId, setCredentialPresetId] = useState<string>();
  const toggleProfilesAdvanced = () => setProfilesAdvanced(value => !value);
  const scroll = useRef<ScrollView>(null);
  const sectionTop = useRef({ solver: 0, verifier: 0, backup: 0 });
  const modelsTop = useRef(0);
  const active = useRef<AbortController | null>(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; void runtime.credentials().then(keys => { if (mounted.current) { if (!managed) { setSolverKey(keys.solver); setVerifierKey(keys.verifier ?? ''); setBackupKey(keys.backup ?? ''); } setReady(true); } }).catch(() => { if (mounted.current) setError('无法读取已保存的密钥。'); }); return () => { mounted.current = false; active.current?.abort(); }; }, [runtime]);
  function configuration() { return LocalSettingsSchema.parse({ schemaVersion: 1, solver, verifier: separate ? verifier : null, backup: useBackup ? backup : null, exam, concurrency: { solver: Number(solverConcurrency), verifier: Number(verifierConcurrency) } }); }
  const draftKeys = () => ({ solver: solverKey.trim(), verifier: separate ? verifierKey.trim() : null, backup: useBackup ? backupKey.trim() : null });
  function loadPreset(preset: WebModelPreset) {
    loadModels(preset.models, preset.id);
  }
  function loadModels(models: WebModelUpdate['models'], presetId?: string) {
    setSolver(models.solver); setVerifier(models.verifier ?? blank); setSeparate(!!models.verifier);
    setBackup(models.backup ?? backupPreset); setUseBackup(!!models.backup);
    setSolverKey(''); setVerifierKey(''); setBackupKey(''); setCredentialPresetId(presetId); setError(''); setMessage(''); setTestRole(null);
  }
  async function presetOperation(operation: () => Promise<void>) {
    setBusy(true); setTestRole(null); setError(''); setMessage('');
    try { await operation(); } finally { if (mounted.current) setBusy(false); }
  }
  async function save() { setBusy(true); setTestRole(null); setError(''); setMessage(''); try { if (!LocalConcurrencySchema.safeParse({ solver: Number(solverConcurrency), verifier: Number(verifierConcurrency) }).success) { setError(`答题并发和校验并发必须是1–${MAX_LOCAL_CONCURRENCY}的整数。`); return; } await runtime.saveSettings(configuration(), draftKeys(), credentialPresetId); onSaved(); onClose(); } catch (cause) { if (mounted.current) setError(managed && cause instanceof Error && !(cause instanceof SyntaxError) && cause.name !== 'ZodError' ? cause.message : '保存失败。请检查 HTTPS 地址、供应商标识、模型名、密钥和容量；输出上限不能超过上下文容量。'); } finally { if (mounted.current) setBusy(false); } }
  async function test(role: 'solver' | 'verifier' | 'backup') { setBusy(true); setTestRole(role); setError(''); setMessage(''); const controller = new AbortController(); active.current = controller; const timer = setTimeout(() => controller.abort(), 15000);
    try {
      // The connection helper validates this profile and key; saving validates both roles.
      const profile = role === 'solver' ? solver : role === 'verifier' ? verifier : backup;
      const key = role === 'solver' ? solverKey : role === 'verifier' ? verifierKey : backupKey;
      const credentials = managed ? await runtime.credentials() : null;
      const source = runtime.modelPresets.find(preset => preset.id === credentialPresetId)?.models;
      const saved = source ? source[role] ?? source.solver : runtime.settings?.[role] ?? runtime.settings?.solver;
      if (managed && editableModels && !key.trim() && (!saved || saved.baseURL !== profile.baseURL.trim().replace(/\/+$/, '') || saved.provider !== profile.provider.trim())) {
        setError('更换服务时请填写新 API Key。'); return;
      }
      await testModelConnection(profile, managed && editableModels ? 'local-connection-test' : key || credentials?.[role] || '', runtime.connectionFetch(role, profile, key, credentialPresetId), controller.signal);
      if (mounted.current) setMessage('文本连接测试通过。图片识别、工具调用和完整解题还需用题目验证。');
    }
    catch (cause) {
      const code = AgentErrorCodeSchema.safeParse(cause instanceof Error && 'code' in cause ? cause.code : undefined);
      if (mounted.current) setError(code.success ? makeSafeAgentError(code.data, 'connection-test').message : '测试未通过。请检查配置、网络和协议；Web 还需要模型服务允许跨域访问。');
    }
    finally { clearTimeout(timer); active.current = null; if (mounted.current) setBusy(false); }
  }
  const connectionFeedback = (role: 'solver' | 'verifier' | 'backup') => testRole === role && (error || message)
    ? <View onLayout={event => scroll.current?.scrollTo({ y: Math.max(0, modelsTop.current + sectionTop.current[role] + event.nativeEvent.layout.y - 12), animated: false })}><Notice text={error || message} error={!!error} /></View>
    : null;
  const content = <SafeAreaView testID="settings-page" style={{ flex: 1, backgroundColor: colors.background }}>
      <PageHeader title="设置" onBack={onClose} disabled={busy} maxWidth={layout.workspaceWidth} />
      <ScrollView testID="settings-scroll" ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {runtime.canManageModelPresets && <ModelPresets presets={runtime.modelPresets} selectedId={credentialPresetId} disabled={busy || !ready}
          onLoad={loadPreset}
          onCreate={name => presetOperation(() => runtime.saveModelPreset(name, configuration(), draftKeys(), credentialPresetId))}
          onActivate={id => presetOperation(async () => { await runtime.activateModelPreset(id); onSaved(); onClose(); })}
          onRemove={id => presetOperation(async () => { await runtime.removeModelPreset(id); if (id === credentialPresetId && runtime.settings) loadModels({ solver: runtime.settings.solver, verifier: runtime.settings.verifier, backup: runtime.settings.backup ?? null }); })} />}
        <View testID="settings-preferences" style={{ gap: 16 }}>
        <Card label="默认考试类型">
          <Text accessibilityRole="header" style={styles.sectionTitle}>默认考试类型</Text>
          <View style={[s.row, { gap: 8 }]}>{(['sat', 'act', 'ap', 'esat', 'tmua', 'tara', 'general'] as const).map(value => <Button key={value} title={EXAM_LABELS[value]} compact selected={exam === value} secondary={exam !== value} disabled={busy} onPress={() => setExam(value)} />)}</View>
        </Card>
        <Card label="批量答题与校验并发">
          <Text accessibilityRole="header" style={styles.sectionTitle}>批量答题与校验并发</Text>
          <View style={s.row}>{([
            ['答题并发', solverConcurrency, setSolverConcurrency],
            ['校验并发', verifierConcurrency, setVerifierConcurrency],
          ] as const).map(([label, value, change]) => <View key={label} style={{ flex: 1, minWidth: 120, gap: 5 }}>
            <Text style={s.label}>{label}（1–{MAX_LOCAL_CONCURRENCY}）</Text>
            <TextInput accessibilityLabel={label} value={value} onChangeText={change} keyboardType="number-pad" editable={!busy && ready} maxLength={2} style={[s.input, { minHeight: 44, height: 44 }]} />
          </View>)}</View>
        </Card>
        </View>
        <View testID="settings-models" onLayout={event => { modelsTop.current = event.nativeEvent.layout.y; }} style={{ gap: 16 }}>
        <View testID="settings-solver" onLayout={event => { sectionTop.current.solver = event.nativeEvent.layout.y; }}>
          <Card label="解题模型">
            <View testID="settings-model-header" style={styles.modelHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>解题模型</Text></View>
            <Profile advanced={profilesAdvanced} onToggleAdvanced={toggleProfilesAdvanced} value={solver} onChange={setSolver} apiKey={solverKey} onKey={setSolverKey} label="解题" managed={managed} showKey={!managed || editableModels} disabled={busy || !ready || !editableModels} />
            <Button title="测试解题模型连接" secondary disabled={busy || !ready || (!managed && !solverKey)} onPress={() => void test('solver')} />
            {testRole === 'solver' && busy && <Text accessibilityLiveRegion="polite" style={s.subtitle}>正在测试解题模型连接…</Text>}
            {connectionFeedback('solver')}
          </Card>
        </View>
        <View testID="settings-verifier" onLayout={event => { sectionTop.current.verifier = event.nativeEvent.layout.y; }}>
          <Card label="校验模型">
            <View testID="settings-model-header" style={styles.modelHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>校验模型</Text>
              <Switch accessibilityLabel="使用独立校验模型" value={separate} disabled={busy || !editableModels} onValueChange={setSeparate} />
            </View>
            {!separate && <Text style={s.subtitle}>沿用解题模型。</Text>}
            {separate && <>
              <Profile advanced={profilesAdvanced} onToggleAdvanced={toggleProfilesAdvanced} value={verifier} onChange={setVerifier} apiKey={verifierKey} onKey={setVerifierKey} label="校验" managed={managed} showKey={!managed || editableModels} disabled={busy || !ready || !editableModels} />
              <Button title="测试校验模型连接" secondary disabled={busy || !ready || (!managed && !verifierKey)} onPress={() => void test('verifier')} />
              {testRole === 'verifier' && busy && <Text accessibilityLiveRegion="polite" style={s.subtitle}>正在测试校验模型连接…</Text>}
              {connectionFeedback('verifier')}
            </>}
          </Card>
        </View>
        <View testID="settings-backup" onLayout={event => { sectionTop.current.backup = event.nativeEvent.layout.y; }}>
          <Card label="备用解题模型">
            <View testID="settings-backup-summary">
              <View testID="settings-model-header" style={styles.modelHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>备用解题模型</Text><Switch accessibilityLabel="启用备用解题模型" value={useBackup} disabled={busy || !editableModels} onValueChange={setUseBackup} /></View>
            </View>
            {useBackup && <View testID="settings-backup-fields" style={{ gap: 12 }}>
              <Profile advanced={profilesAdvanced} onToggleAdvanced={toggleProfilesAdvanced} value={backup} onChange={setBackup} apiKey={backupKey} onKey={setBackupKey} label="备用" managed={managed} showKey={!managed || editableModels} disabled={busy || !ready || !editableModels} />
              <Button title="测试备用模型连接" secondary disabled={busy || !ready || (!managed && !backupKey)} onPress={() => void test('backup')} />
              {testRole === 'backup' && busy && <Text accessibilityLiveRegion="polite" style={s.subtitle}>正在测试备用模型连接…</Text>}
              {connectionFeedback('backup')}
            </View>}
          </Card>
        </View>
        </View>
        <SettingsHelp managed={managed} />
      </ScrollView>
      <View testID="settings-actions" style={styles.actions}>
        {testRole === null && (error || message) ? <View style={{ width: '100%' }}><Notice text={error || message} error={!!error} /></View> : null}
        {!managed && <Button title="清除已保存密钥" danger secondary disabled={busy || !ready || !editableModels} onPress={() => { setBusy(true); setTestRole(null); setError(''); setMessage(''); void runtime.clearKeys().then(() => { setSolverKey(''); setVerifierKey(''); setBackupKey(''); onSaved(); setMessage('密钥已清除，题目记录保留。'); }).catch(() => setError('清除密钥失败。')).finally(() => { if (mounted.current) setBusy(false); }); }} />}
        <Button title={busy ? '正在处理…' : '保存设置'} disabled={busy || !ready} onPress={() => void save()} />
      </View>
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
function SettingsHelp({ managed }: { managed: boolean }) {
  const [open, setOpen] = useState(false);
  return <View testID="settings-help" style={styles.advanced}>
    <Pressable accessibilityRole="button" accessibilityLabel="配置说明" accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen(value => !value)} style={styles.advancedToggle}><Text style={s.label}>配置说明</Text><Text style={s.link}>{open ? '收起' : '展开'}</Text></Pressable>
    {open && <View style={{ gap: 10 }}>
      <Text style={s.subtitle}>{managed ? '初始配置来自 .env；模型修改保存在本机服务的独立配置文件，不覆盖 .env。已配置的密钥留空可保留，更换服务需填写新密钥。' : Platform.OS === 'web' ? 'Web 密钥只在内存保留，刷新后需重新输入。' : '密钥保存在系统安全存储。'}</Text>
      {managed && <Text style={s.subtitle}>配置预设保存解题、校验和备用三组模型。“载入”仅编辑草稿，“启用”直接应用已保存的整组配置；考试与并发保持不变。另存不会覆盖已有预设，最多保留8组。预设密钥只存本机服务端。</Text>}
      <Text style={s.subtitle}>新设置用于后续任务，历史题目保留考试快照。校验与答题独立排队，备用模型在失败或校验判错时接手一次。</Text>
      <Text style={s.subtitle}>题图与同题上下文会发送给选定的服务；连接测试与备用调用可能收费。题目保存在本机，清除应用数据会丢失记录。</Text>
      <Text style={s.subtitle}>服务地址填写 API Base URL（如 /v1），无需添加 /chat/completions 或 /responses。接口协议与思考参数按服务文档选择；Responses 使用 reasoning.effort，部分模型不支持关闭思考。</Text>
      <Text style={s.subtitle}>Chat Completions 的思考参数支持 thinking.type、enable_thinking 与 reasoning_effort；thinking.type 的低/中/高映射为 low/high/max。输出参数名按服务文档选择。</Text>
    </View>}
  </View>;
}
function Profile({ value, onChange, apiKey, onKey, label, disabled, advanced, onToggleAdvanced, managed = false, showKey = true }: { value: LocalModelProfile; onChange: (value: LocalModelProfile) => void; apiKey: string; onKey: (value: string) => void; label: string; disabled: boolean; advanced: boolean; onToggleAdvanced: () => void; managed?: boolean; showKey?: boolean }) {
  const field = (name: string, current: string, change: (text: string) => void, secret = false, numeric = false) => <View style={{ gap: 5 }}>
    <Text style={s.label}>{name}</Text>
    <TextInput accessibilityLabel={`${label}${name}`} value={current} onChangeText={change} editable={!disabled} autoCapitalize="none" autoCorrect={false} secureTextEntry={secret} placeholder={secret && managed ? '已配置则留空保留；更换服务填写新密钥' : undefined} keyboardType={numeric ? 'number-pad' : 'default'} maxLength={secret ? 2048 : numeric ? 8 : 256} style={[s.input, { minHeight: 48 }]} />
  </View>;
  const thinking = resolveThinking(value);
  return <View style={{ gap: 12 }}>
    {field('服务地址', value.baseURL, baseURL => onChange({ ...value, baseURL }))}
    {field('供应商标识', value.provider, provider => onChange({ ...value, provider }))}
    {field('模型引用名', value.model, model => onChange({ ...value, model }))}
    {showKey && field('API Key', apiKey, onKey, true)}
    <Text style={s.label}>接口协议</Text>
    <View style={[s.row, { gap: 8 }]}>{([['openai-completions', 'Chat Completions'], ['openai-responses', 'Responses']] as const).map(([api, title]) => <Button key={api} title={title} compact selected={value.api === api} secondary={value.api !== api} disabled={disabled} onPress={() => onChange({ ...value, api })} />)}</View>
    <Text style={s.label}>深度思考</Text>
    <View style={[s.row, { gap: 8 }]}>{([
      ['provider-default', '服务默认'], ['off', '关闭'], ['on', '开启'],
    ] as const).map(([mode, title]) => <Button key={mode} title={title} compact selected={thinking.mode === mode} secondary={thinking.mode !== mode} disabled={disabled} onPress={() => onChange(applyThinking(value, { ...thinking, mode }))} />)}</View>
    <View style={{ gap: 12 }}>
      <Text style={s.label}>思考强度</Text>
      <View style={[s.row, { gap: 8 }]}>{([['low', '低'], ['medium', '中'], ['high', '高']] as const).map(([effort, title]) => <Button key={effort} title={title} compact selected={(thinking.effort ?? 'medium') === effort} secondary={(thinking.effort ?? 'medium') !== effort} disabled={disabled || thinking.mode !== 'on'} onPress={() => onChange(applyThinking(value, { ...thinking, effort }))} />)}</View>
    </View>
    <View style={styles.advanced}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}高级参数`} accessibilityState={{ expanded: advanced, disabled }} aria-expanded={advanced} disabled={disabled} onPress={onToggleAdvanced} style={styles.advancedToggle}>
        <Text style={s.label}>高级参数</Text><Text style={s.link}>{advanced ? '收起' : '展开'}</Text>
      </Pressable>
      {advanced && <View style={{ gap: 12 }}>
        <Text style={s.label}>响应方式</Text>
        <View style={[s.row, { gap: 8 }]}>{([false, true] as const).map(streaming => <Button key={String(streaming)} title={streaming ? '流式' : '非流式'} compact selected={(value.streaming ?? label === '解题') === streaming} secondary={(value.streaming ?? label === '解题') !== streaming} disabled={disabled} onPress={() => onChange({ ...value, streaming })} />)}</View>
        {field('上下文容量', String(value.contextWindow || ''), text => onChange({ ...value, contextWindow: Number(text) }), false, true)}
        {field('最大输出 tokens', String(value.maxTokens || ''), text => onChange({ ...value, maxTokens: Number(text) }), false, true)}
        <View style={{ gap: 12 }}>
          <Text style={s.label}>思考参数协议</Text>
          <View style={[s.row, { gap: 8 }]}>{([['thinking-type', 'thinking.type'], ['enable-thinking', 'enable_thinking'], ['reasoning-effort', 'reasoning_effort']] as const).map(([protocol, title]) => <Button key={protocol} title={title} compact selected={(thinking.protocol ?? 'thinking-type') === protocol} secondary={(thinking.protocol ?? 'thinking-type') !== protocol} disabled={disabled || thinking.mode === 'provider-default' || value.api !== 'openai-completions'} onPress={() => onChange(applyThinking(value, { ...thinking, protocol }))} />)}</View>
        </View>
        <View style={[styles.switchRow, { minHeight: 44 }]}>
          <Switch accessibilityLabel={`${label}使用max_completion_tokens`} value={value.maxTokensField === 'max_completion_tokens'} disabled={disabled || value.api !== 'openai-completions'} onValueChange={enabled => onChange({ ...value, maxTokensField: enabled ? 'max_completion_tokens' : 'max_tokens' })} />
          <Text style={[s.subtitle, styles.switchLabel]}>max_completion_tokens</Text>
        </View>
      </View>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center', padding: 10, paddingBottom: 24, gap: 16 },
  actions: { width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  modelHeader: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  switchLabel: { flex: 1, minWidth: 0 },
  advanced: { borderTopWidth: 1, borderTopColor: colors.line, gap: 8, marginTop: 4 },
  advancedToggle: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
});
