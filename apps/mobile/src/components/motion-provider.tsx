import { createContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

export const ReducedMotion = createContext(true);

// Read once so a new modal knows the preference before native presentation.
export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true; let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true; if (alive) setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (alive && !changed) setReduced(value);
    }).catch(() => { /* Retain the conservative default if the platform cannot read it. */ });
    return () => { alive = false; subscription.remove(); };
  }, []);
  return <ReducedMotion.Provider value={reduced}>{children}</ReducedMotion.Provider>;
}
