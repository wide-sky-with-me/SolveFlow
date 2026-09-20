import { forwardRef, type ComponentProps, type ComponentRef } from 'react';
import * as RN from 'react-native';
import { SafeAreaView as SafeView } from 'react-native-safe-area-context';
import { useTheme } from './provider';
import { themeColor, themeColors, type ThemeScheme } from './palette';
const colorKeys = ['backgroundColor', 'color', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'shadowColor', 'textDecorationColor'];
function adapt<T extends object>(style: RN.StyleProp<T>, scheme: ThemeScheme) {
  const flat = RN.StyleSheet.flatten(style); if (!flat || scheme === 'light') return flat;
  const result = { ...flat };
  for (const key of colorKeys) { const value: unknown = Reflect.get(result, key); if (typeof value === 'string') Reflect.set(result, key, themeColor(value, key, scheme)); }
  return result;
}
export const View = forwardRef<ComponentRef<typeof RN.View>, ComponentProps<typeof RN.View>>((p, ref) => { const { scheme } = useTheme(); return <RN.View {...p} ref={ref} style={adapt(p.style, scheme)} />; });
export const Text = forwardRef<ComponentRef<typeof RN.Text>, ComponentProps<typeof RN.Text>>((p, ref) => { const { scheme } = useTheme(); return <RN.Text {...p} ref={ref} style={[{ color: themeColors[scheme].ink }, adapt(p.style, scheme)]} />; });
export const TextInput = forwardRef<ComponentRef<typeof RN.TextInput>, ComponentProps<typeof RN.TextInput>>((p, ref) => { const { scheme } = useTheme(); return <RN.TextInput {...p} ref={ref} keyboardAppearance={scheme} placeholderTextColor={themeColors[scheme].muted} selectionColor={themeColors[scheme].accent} style={adapt(p.style, scheme)} />; });
export const Pressable = forwardRef<ComponentRef<typeof RN.View>, ComponentProps<typeof RN.Pressable>>((p, ref) => { const { scheme } = useTheme(); const style = p.style; return <RN.Pressable {...p} ref={ref} style={state => adapt(typeof style === 'function' ? style(state) : style, scheme)} />; });
export const ScrollView = forwardRef<ComponentRef<typeof RN.ScrollView>, ComponentProps<typeof RN.ScrollView>>((p, ref) => { const { scheme } = useTheme(); return <RN.ScrollView {...p} ref={ref} indicatorStyle={scheme === 'dark' ? 'white' : 'black'} style={adapt(p.style, scheme)} contentContainerStyle={adapt(p.contentContainerStyle, scheme)} />; });
export const Image = forwardRef<ComponentRef<typeof RN.Image>, ComponentProps<typeof RN.Image>>((p, ref) => { const { scheme } = useTheme(); return <RN.Image {...p} ref={ref} style={adapt(p.style, scheme)} />; });
export const SafeAreaView = forwardRef<ComponentRef<typeof SafeView>, ComponentProps<typeof SafeView>>((p, ref) => { const { scheme } = useTheme(); return <SafeView {...p} ref={ref} style={[{ backgroundColor: themeColors[scheme].surface }, adapt(p.style, scheme)]} />; });
export const AnimatedView = forwardRef<ComponentRef<typeof RN.View>, ComponentProps<typeof RN.Animated.View>>((p, ref) => { const { scheme } = useTheme(); return <RN.Animated.View {...p} ref={ref} style={adapt(p.style, scheme)} />; });
export const AnimatedText = forwardRef<ComponentRef<typeof RN.Text>, ComponentProps<typeof RN.Animated.Text>>((p, ref) => { const { scheme } = useTheme(); return <RN.Animated.Text {...p} ref={ref} style={adapt(p.style, scheme)} />; });
export type TextInput = RN.TextInput;
export type ScrollView = RN.ScrollView;
export type View = RN.View;
