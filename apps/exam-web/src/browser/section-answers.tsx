import { useId } from 'react';
import type { ExamSlot } from '@solveflow/contracts/managed-exam';
import { answerValue } from './answer-value.js';
import { AnswerValueText } from './answer-value-text.js';
import { overviewClass, overviewLegend, overviewState } from './slot-state.js';

export function SlotStateLegend() {
    return <ul className="slot-state-legend" role="list" aria-label="题目状态图例">{overviewLegend.map(state => <li key={state.state} className={overviewClass(state)}><span className="slot-state-dot" aria-hidden="true"/>{state.label}</li>)}</ul>;
}

export function SectionAnswers({ slots, selectedId, alerts, disabled, onSelect }: { slots: ExamSlot[]; selectedId: string | null; alerts: Set<string>; disabled: boolean; onSelect: (slot: ExamSlot) => void }) {
    const prefix = useId();
    return <section className="section-answers" aria-label="本节答案总览"><SlotStateLegend/><div className="section-answer-grid">{slots.map(slot => {
        const flagged = alerts.has(slot.id), state = overviewState(slot, flagged), answer = slot.presentation;
        const compact = answer ? answerValue(answer) : null;
        const value = answer && !['answering', 'error'].includes(state.state) && slot.status !== 'verifying' ? answer.selectedOptions?.length ? answer.selectedOptions.join('、') : compact ?? '查看答案' : null;
        const description = prefix + '-' + slot.id;
        return <button key={slot.id} title={state.detail + (answer ? ' · ' + answer.answer : '')} aria-label={'第' + slot.position + '题'} aria-describedby={(value ? description + '-answer ' : '') + description} aria-current={selectedId === slot.id ? 'step' : undefined} disabled={disabled} className={overviewClass(state) + (selectedId === slot.id ? ' current' : '')} onClick={() => onSelect(slot)}>
          <span className="section-answer-number">{slot.position}</span>{value && <div id={description + '-answer'} className="section-answer-value">{compact ? <AnswerValueText value={value}/> : value}</div>}<span id={description} className="overview-phase"><span className="slot-state-dot" aria-hidden="true"/>{state.label}</span>{flagged && <span className="section-answer-alert feedback-tone-error" aria-label="待处理">!</span>}
        </button>;
    })}</div></section>;
}
