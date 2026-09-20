import { themeColors } from '../theme/palette';
import { useTheme } from '../theme/provider';
import { Text, View } from '../theme/primitives';
import { useState } from 'react';

import MathPreview from '../dom/math-preview';
import { documentProps } from '../document-props';
import { s } from './ui';

/** The same offline, untrusted-Markdown renderer used for answer content. */
export function ConversationText({ text, label }: { text: string; label: string }) {
  const { scheme } = useTheme();
  const [failed, setFailed] = useState(false);
  return <View style={{ gap: 6 }}><Text style={s.subtitle}>{label}</Text>{failed
    ? <><Text selectable style={s.subtitle}>{text}</Text><Text style={s.subtitle}>公式暂未加载，已保留原文。</Text></>
    : <MathPreview theme={scheme} mode="message" previewPayload={encodeURIComponent(text)} dom={{ ...documentProps, style: { backgroundColor: themeColors[scheme].background }, onError: () => setFailed(true), onHttpError: () => setFailed(true), onRenderProcessGone: () => setFailed(true) }} />}</View>;
}
