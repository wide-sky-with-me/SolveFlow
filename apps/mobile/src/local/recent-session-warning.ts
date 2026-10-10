// Only the current optional-cache problem is retained; subscribers are released on unmount.
let warning = '';
const listeners = new Set<() => void>();
export function getRecentSessionWarning() { return warning; }
export function subscribeRecentSessionWarning(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setRecentSessionUnavailable(unavailable: boolean) {
  const next = unavailable ? '最近题目位置暂时无法读取或保存；题目记录不受影响。' : '';
  if (next === warning) return;
  warning = next;
  for (const listener of listeners) listener();
}
