import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { EXAM_LABELS, ExamTypeSchema, type ExamType } from '@solveflow/contracts/local';
import { Icon } from './icons.js';

const exams = ExamTypeSchema.options;

export function ExamPicker({ value, disabled, onChange }: { value: ExamType; disabled: boolean; onChange: (exam: ExamType) => void }) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  function show() {
    if (disabled) return;
    setFocused(exams.indexOf(value));
    setOpen(true);
  }

  useEffect(() => {
    if (disabled) close();
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (open) options.current[focused]?.focus();
  }, [open, focused]);

  function navigate(event: KeyboardEvent) {
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (focused + 1) % exams.length;
    if (event.key === 'ArrowUp') next = (focused + exams.length - 1) % exams.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = exams.length - 1;
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key.length === 1 && /^[a-z]$/i.test(event.key)) {
      const match = exams.map((_, i) => (focused + i + 1) % exams.length)
        .find(i => EXAM_LABELS[exams[i]!].toLowerCase().startsWith(event.key.toLowerCase()));
      if (match !== undefined) next = match;
    }
    if (next !== undefined) { event.preventDefault(); setFocused(next); }
  }

  return <div ref={root} className="exam-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <button ref={trigger} type="button" className="exam-trigger" aria-label="考试类型" aria-describedby={`${id}-value`} aria-haspopup="listbox" aria-controls={open ? id : undefined} aria-expanded={open} disabled={disabled}
      onClick={() => open ? close(true) : show()}
      onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show(); } }}>
      <Icon name="book" className="exam-book"/><span id={`${id}-value`}>{EXAM_LABELS[value]}</span><Icon name="chevron-down" className="exam-chevron"/>
    </button>
    {open && <div className="exam-popover" onKeyDown={navigate}>
      <div className="exam-popover-title">选择考试</div>
      <div id={id} role="listbox" aria-label="考试类型">
        {exams.map((exam, index) => <button key={exam} ref={node => { options.current[index] = node; }} type="button" role="option" aria-selected={exam === value}
          tabIndex={focused === index ? 0 : -1} className={`exam-option ${exam === value ? 'selected' : ''}`}
          onClick={() => { onChange(exam); close(true); }}>
          <span>{EXAM_LABELS[exam]}</span>{exam === value && <Icon name="check"/>}
        </button>)}
      </div>
    </div>}
  </div>;
}
