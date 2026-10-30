import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { Pressable, SafeAreaView, Text, View } from '../theme/primitives';
import { MotionModal } from './motion-modal';
import { Button, colors, s } from './ui';

export function BatchImportDialog({ title, busy, onClose, children, footer, testID = 'batch-import-dialog', closeTitle = '关闭导入', maxWidth = 760, avoidKeyboard = false }: { title: string; busy: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; testID?: string; closeTitle?: string; maxWidth?: number; avoidKeyboard?: boolean }) {
  const { width } = useWindowDimensions();
  return <MotionModal transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: '#17233866' }}>
      <KeyboardAvoidingView enabled={avoidKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, padding: width < 600 ? 12 : 24, alignItems: 'center', justifyContent: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${closeTitle}弹窗`} disabled={busy} onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <View testID={testID} style={{ width: '100%', maxWidth, maxHeight: '100%', minHeight: 0, flexShrink: 1, overflow: 'hidden', borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', shadowColor: '#172338', shadowOffset: { width: 0, height: 12 }, shadowOpacity: .18, shadowRadius: 32, elevation: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, flexShrink: 0 }}>
            <Text accessibilityRole="header" style={[s.title, { flex: 1, minWidth: 0 }]}>{title}</Text>
            <Button title={closeTitle} compact secondary disabled={busy} onPress={onClose} />
          </View>
          {children}
          {footer != null && <View testID="batch-import-footer" style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 20, paddingVertical: 12, flexShrink: 0, gap: 8 }}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </MotionModal>;
}
