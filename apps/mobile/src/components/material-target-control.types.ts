import type { ReactNode } from 'react';
export interface MaterialTargetControlProps {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
  onPreview: () => void;
  onFocus: () => void;
  onBlur: () => void;
  children: ReactNode;
}
