import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { StatusBar, useColorScheme, View } from 'react-native';
import { z } from 'zod';
import { openDocuments } from '../local/documents';
import { themeColors, type ThemeMode, type ThemeScheme } from './palette';
const preferenceSchema = z.strictObject({ schemaVersion: z.literal(1), mode: z.enum(['system', 'light', 'dark']) });
const ThemeContext = createContext<{ mode: ThemeMode; scheme: ThemeScheme; error: string; setMode: (mode: ThemeMode) => Promise<void> }>({ mode: 'system', scheme: 'light', error: '', async setMode() {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme(); const [mode, setMode] = useState<ThemeMode>('system'); const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const scheme = mode === 'system' ? system === 'dark' ? 'dark' : 'light' : mode;
  useEffect(() => { let alive = true; void openDocuments().then(d => d.get('appearance')).then(raw => { const parsed = raw ? preferenceSchema.safeParse(JSON.parse(raw)) : null; if (alive && parsed?.success) setMode(parsed.data.mode); else if (alive && raw) setError('外观设置无效，暂时跟随系统。'); }).catch(() => { if (alive) setError('外观设置未能读取，暂时跟随系统。'); }).finally(() => { if (alive) setReady(true); }); return () => { alive = false; }; }, []);
  async function save(value: ThemeMode) { const parsed = preferenceSchema.parse({ schemaVersion: 1, mode: value }); await (await openDocuments()).put('appearance', JSON.stringify(parsed)); setMode(value); setError(''); }
  return <ThemeContext.Provider value={{ mode, scheme, error, setMode: save }}><StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />{ready ? children : <View testID="launch-screen" accessibilityLabel="正在启动" style={{ flex: 1, backgroundColor: themeColors[scheme].background }} />}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
