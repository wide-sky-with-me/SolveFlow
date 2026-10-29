import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

type ExpiringMessage = { text: string; expiresAt: number };

/** A receipt expires independently of the task that produced it. */
export function useExpiringNotice(scope: string, active: boolean) {
  const [message, setMessage] = useState<ExpiringMessage | null>(null);
  const clear = useCallback(() => setMessage(null), []);
  const show = useCallback((text: string) => setMessage({ text, expiresAt: Date.now() + 5000 }), []);

  useEffect(() => {
    if (!message) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Keep the original deadline when rendering or background timers are delayed.
    const check = () => {
      if (timer !== undefined) clearTimeout(timer);
      const remaining = message.expiresAt - Date.now();
      if (remaining <= 0) setMessage(current => current?.expiresAt === message.expiresAt ? null : current);
      else timer = setTimeout(check, remaining);
    };
    check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { if (timer !== undefined) clearTimeout(timer); subscription.remove(); };
  }, [message]);
  useEffect(clear, [scope, active, clear]);

  return { message: message && Date.now() < message.expiresAt ? message.text : null, show, clear };
}
