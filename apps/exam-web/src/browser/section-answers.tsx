import { useId } from 'react';
import type { ExamAlert, ExamSlot } from '@solveflow/contracts/managed-exam';
import { answerValue } from './answer-value.js';
import { AnswerValueText } from './answer-value-text.js';
import { overviewClass, overviewLegend, overviewState } from './slot-state.js';

export function SlotStateLegend() {
    return <ul className="slot-state-legend" role="list" aria-label="题目状态图例">{overviewLegend.map(state => <li key={state.state} className={overviewClass(state)}><span className="slot-state-dot" aria-hidden="true"/>{state.label}</li>)}</ul>;
}

export function SlotAnswerValue({ slot, id }: { slot: ExamSlot; id?: string }) {
    const answer = slot.presentation ?? slot.draft;
    if (!answer) return null;
    const compact = answerValue(answer);
    const choice = answer.selectedOptions?.join('、');
    if (choice) return <span id={id} className="section-answer-value">{choice}</span>;
    if (compact) return <span id={id} className="section-answer-value"><AnswerValueText value={compact}/></span>;
    const text = answer.answer.trim();
    const characters = Array.from(text.slice(0, 130));
    const excerpt = characters.length > 64 ? characters.slice(0, 64).join('') + '…' : text;
    return <span id={id} className="section-answer-value section-answer-excerpt" title={text}>{excerpt}</span>;
}

export function SectionAnswers({ slots, selectedId, alerts, disabled, onSelect }: { slots: ExamSlot[]; selectedId: string | null; alerts: Map<string, ExamAlert['reason']>; disabled: boolean; onSelect: (slot: ExamSlot) => void }) {
    const prefix = useId();
    return <section className="section-answers" aria-label="本节答案总览"><SlotStateLegend/><div className="section-answer-grid">{slots.map(slot => {
        const reason = alerts.get(slot.id), state = overviewState(slot, reason), answer = slot.presentation ?? slot.draft;
        const description = prefix + '-' + slot.id;
        return <button key={slot.id} title={state.detail + (answer ? ' · ' + answer.answer : '')} aria-label={'第' + slot.position + '题'} aria-describedby={(answer ? description + '-answer ' : '') + description} aria-current={selectedId === slot.id ? 'step' : undefined} disabled={disabled} className={overviewClass(state) + (selectedId === slot.id ? ' current' : '')} onClick={() => onSelect(slot)}>
          <span className="section-answer-number">{slot.position}</span><SlotAnswerValue slot={slot} id={description + '-answer'}/><span id={description} className="overview-phase"><span className="slot-state-dot" aria-hidden="true"/>{state.label}</span>{reason && <span className="section-answer-alert" aria-label="待处理">!</span>}
        </button>;
    })}</div></section>;
}
