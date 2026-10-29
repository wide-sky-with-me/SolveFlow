import { Pressable } from '../theme/primitives';
import type { MaterialTargetControlProps } from './material-target-control.types';

export function MaterialTargetControl({ label, checked, disabled, onPress, onPreview, onFocus, onBlur, children }: MaterialTargetControlProps) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityHint="长按查看原图" accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} onLongPress={onPreview} onFocus={onFocus} onBlur={onBlur}
    style={{ flex: 1, minWidth: 0, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}>{children}</Pressable>;
}
