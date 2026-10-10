import { themeColors } from '../theme/palette';
import { useTheme } from '../theme/provider';
import { Text, TextInput, View } from '../theme/primitives';
import { useRef, useState } from 'react';

import { insertTex, type TexTemplate } from '@solveflow/client/presentation';
import MathPreview from '../dom/math-preview';
import { documentProps } from '../document-props';
import { Button, s } from './ui';

export function FormulaEditor({ value, onChange, disabled }: { value: string; onChange: (text: string) => void; disabled: boolean }) {
  const { scheme } = useTheme();
  const input = useRef<TextInput>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [failed, setFailed] = useState(false);
  function insert(template: TexTemplate) {
    const result = insertTex(value, selection, template);
    if (!result || disabled) return;
    onChange(result.text); setSelection(result.selection); input.current?.focus();
  }
  return <View style={{ gap: 12 }}>
    <TextInput ref={input} accessibilityLabel="更正后的题干" multiline maxLength={2000} value={value} onChangeText={onChange} editable={!disabled} autoCorrect={false} autoCapitalize="none" selection={selection} onSelectionChange={event => setSelection(event.nativeEvent.selection)} style={[s.input, { minHeight: 160 }]} />
    <View style={s.row}>{([['formula', '公式'], ['fraction', '分数'], ['root', '根号'], ['power', '上标'], ['subscript', '下标']] as const).map(([template, label]) => <Button key={template} title={label} secondary compact disabled={disabled || value.length >= 2000} onPress={() => insert(template)} />)}</View>
    <Text style={s.label}>预览</Text>
    {failed ? <Text style={s.subtitle}>预览暂不可用，题干源码仍可编辑和保存。</Text> : <MathPreview theme={scheme} previewPayload={encodeURIComponent(value)} dom={{ ...documentProps, style: { backgroundColor: themeColors[scheme].background }, onError: () => setFailed(true), onHttpError: () => setFailed(true), onRenderProcessGone: () => setFailed(true) }} />}
  </View>;
}
