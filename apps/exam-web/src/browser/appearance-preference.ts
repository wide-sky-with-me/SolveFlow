export const APPEARANCE_KEY = 'solveflow-exam-appearance';
export type Appearance = 'system' | 'light' | 'dark';
export function validAppearance(value: unknown): value is Appearance { return value === 'system' || value === 'light' || value === 'dark'; }
export function appearanceBootScript() {
    return `try{const t=localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)});if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch{}`;
}
