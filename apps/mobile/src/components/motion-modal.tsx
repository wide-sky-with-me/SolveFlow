import { Modal, Platform, type ModalProps } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useReducedMotion } from './use-reduced-motion';

export function MotionModal({ animationType, children, supportedOrientations, ...props }: ModalProps) {
  const reduced = useReducedMotion();
  // iOS modals have their own native root; measure its insets after presentation.
  return (
    <Modal {...props} animationType={reduced ? 'none' : animationType}
      supportedOrientations={supportedOrientations ?? (Platform.OS === 'ios' ? ['portrait', 'landscape'] : undefined)}>
      {Platform.OS === 'ios' ? <SafeAreaProvider>{children}</SafeAreaProvider> : children}
    </Modal>
  );
}
