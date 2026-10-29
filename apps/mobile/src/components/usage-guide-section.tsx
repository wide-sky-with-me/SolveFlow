import type { ReactNode } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { Image, Text, View } from '../theme/primitives';
import { Card, colors, s } from './ui';

export function UsageGuideSection({ title, steps, children }: { title: string; steps: readonly string[]; children?: ReactNode }) {
  return <Card label={title} style={{ gap: 14 }}>
    <Text accessibilityRole="header" style={[s.label, { fontSize: 18, lineHeight: 26 }]}>{title}</Text>
    {steps.map((step, index) => <Text key={step} style={{ fontSize: 14, lineHeight: 24 }}>{index + 1}. {step}</Text>)}
    {children}
  </Card>;
}

export function UsageGuideFigure({ source, width, height, caption }: { source: ImageSourcePropType; width: number; height: number; caption: string }) {
  return <View testID="usage-guide-figure" style={{ gap: 10, alignItems: 'center' }}>
    {/* RN Web adds intrinsic asset dimensions; let the frame determine both display dimensions. */}
    <View style={{ width: '100%', maxWidth: 360, aspectRatio: width / height, borderRadius: 10, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
      <Image source={source} accessibilityLabel={caption} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
    </View>
    <Text style={[s.subtitle, { fontSize: 13, lineHeight: 21 }]}>{caption}</Text>
  </View>;
}
