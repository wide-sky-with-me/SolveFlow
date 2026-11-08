import type { ExamPresentation } from '@solveflow/contracts/managed-exam';
import { RichText } from './rich-text.js';
import { answerValue } from './answer-value.js';
import { AnswerValueText } from './answer-value-text.js';
import './answer-summary.css';

type Answer = Pick<ExamPresentation, 'answer' | 'selectedOptions' | 'verified' | 'simulated' | 'responseValue'>;
export function AnswerSummary({answer,options}: {answer: Answer; options?: readonly {label: string; text: string}[] | undefined}) {
    const fill = answerValue(answer), tone = answer.verified && !answer.simulated ? 'success' : 'warning';
    return <div className="answer-summary">
      {fill && <div className={'answer-fill feedback-tone-'+tone} aria-label="填空答案"><AnswerValueText value={fill}/></div>}
      {answer.selectedOptions?.map(label => {
          const option = options?.find(option => option.label === label);
          return <div className="answer-choice-row" key={label}><strong className={'answer-options feedback-tone-'+tone}>{label}</strong>{option && <div className="answer-choice-text" title={option.text}><RichText text={option.text}/></div>}</div>;
      })}
      {(!fill || answer.answer.trim() !== fill) && <RichText text={answer.answer}/>}
    </div>;
}
