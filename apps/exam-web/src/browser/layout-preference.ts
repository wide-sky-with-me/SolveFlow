const SIDEBAR_KEY = 'solveflow-exam-sidebar-collapsed';
export function readSidebarCollapsed() { try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; } }
export function saveSidebarCollapsed(value: boolean) { try { localStorage.setItem(SIDEBAR_KEY, String(value)); } catch { /* Layout changes do not depend on storage availability. */ } }
