import type { ReactNode } from 'react';
import { SafeAreaView, ScrollView } from '../theme/primitives';
import { Card, s } from './ui';

/** Shared centered dialogs remain reachable when the viewport or keyboard is short. */
export function DialogSurface({ children }: { children: ReactNode }) {
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#17233866' }}>
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={s.dialogContainer}>
      <Card style={s.dialogCard}>{children}</Card>
    </ScrollView>
  </SafeAreaView>;
}
