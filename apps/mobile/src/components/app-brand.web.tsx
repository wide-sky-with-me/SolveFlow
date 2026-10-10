import { useTheme } from '../theme/provider';
import { EXAM_LABELS, type ExamType } from '@solveflow/contracts/local';

export function AppBrand({ exam }: { exam: ExamType }) {
  const { scheme } = useTheme();
  return <div data-testid="desktop-brand" data-theme={scheme}>
    <span className="desktop-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.8" /><path d="m8.5 12 2.3 2.3 4.7-4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
    <span className="desktop-brand-copy">SolveFlow</span>
    <span className="desktop-exam" data-testid="desktop-exam"><span aria-hidden="true" />默认考试 · {EXAM_LABELS[exam]}</span>
  </div>;
}
