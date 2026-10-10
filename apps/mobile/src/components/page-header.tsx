import { Text, View } from '../theme/primitives';
import { Button, colors, layout, s } from './ui';

/** Keep the exit visible while long forms or progress reports scroll below it. */
export function PageHeader({ title, onBack, disabled = false, maxWidth = layout.formWidth }: {
  title: string;
  onBack: () => void;
  disabled?: boolean;
  maxWidth?: number;
}) {
  return <View style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.line, flexShrink: 0 }}>
    <View style={{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Button title="返回" secondary compact disabled={disabled} onPress={onBack} />
      <Text accessibilityRole="header" style={[s.title, { flex: 1, flexShrink: 1 }]}>{title}</Text>
    </View>
  </View>;
}
