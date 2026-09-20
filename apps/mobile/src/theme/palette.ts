export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeScheme = 'light' | 'dark';
export const themeColors = {
  light: { background: '#f5f7fb', surface: '#ffffff', ink: '#172338', muted: '#6b7a90', line: '#e3eaf3', accent: '#2867dd' },
  dark: { background: '#0e1520', surface: '#182232', ink: '#e6edf7', muted: '#a6b5ca', line: '#334156', accent: '#8bb5ff' },
};
// Existing light design tokens map to deliberate dark roles, without filtering photos or changing geometry.
const backgrounds: Record<string, string> = {
  '#fff': '#182232', '#ffffff': '#182232', '#f5f7fb': '#0e1520', '#f7f9fc': '#111b2a', '#f8faff': '#111b2a',
  '#edf3ff': '#243955', '#eef3fb': '#243955', '#f1f5fc': '#243955', '#deebff': '#304d74', '#e4eeff': '#304d74',
  '#fff0ee': '#41292c', '#fbe2df': '#593338', '#fff7e6': '#3e3423', '#e3eaf3': '#334156', '#e7ecf3': '#334156',
  '#f0f5ff': '#1e3049', '#eaf1ff': '#263b59', '#dbe8ff': '#314b70', '#d5e3ff': '#304767', '#c8dafa': '#3c557b',
  '#e1eaf9': '#324965', '#e1e9f6': '#324965', '#eef2f7': '#202e42', '#eef2f8': '#202e42', '#fff3d9': '#433722', '#bdd8ee': '#345267',
  '#c2d7ff': '#426491', '#d9e6ff': '#35537a',
};
const foregrounds: Record<string, string> = {
  '#172338': '#e6edf7', '#182235': '#e6edf7', '#6b7a90': '#a6b5ca', '#738299': '#a6b5ca', '#738276': '#a8c4b2',
  '#2867dd': '#8bb5ff', '#2761cf': '#8bb5ff', '#a33229': '#ffb2a8', '#b33939': '#ffb2a8', '#95630d': '#e8c37e', '#755014': '#e8c37e',
};
export function themeColor(value: string, property: string, scheme: ThemeScheme): string {
  if (scheme === 'light') return value;
  const key = value.toLowerCase();
  if (property === 'color') return foregrounds[key] ?? value;
  if (property.includes('border') || property === 'textDecorationColor') return backgrounds[key] ?? (key === '#d8e2ef' ? '#40536e' : value);
  return backgrounds[key] ?? value;
}
