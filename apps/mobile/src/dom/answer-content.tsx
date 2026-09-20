import { type AnswerCandidate } from "@solveflow/contracts/agent";
import { questionSections } from "@solveflow/contracts/http";
import { AnswerFigure } from "./answer-figure";
import { MathBlock, MathText } from "./math-text";

type Step = AnswerCandidate["steps"][number];
type Actions = { onVerify?: (() => void) | undefined; verificationLabel?: string | undefined; verificationDisabled?: boolean | undefined; disabled?: boolean | undefined; onAskStep?: ((step: Step, label: string) => void) | undefined; onAskQuestion?: ((number: number) => void) | undefined };
export function TeachingSteps({ steps, originalImageUrl, onAskStep, disabled, questionNumber }: { steps: AnswerCandidate["steps"]; originalImageUrl?: string | undefined; questionNumber?: number } & Actions) {
  return <ol className="teaching-steps">{steps.map((step, index) => <li key={step.id}>
    <span className="teaching-number" aria-label={`步骤 ${index + 1}`}>{index + 1}</span><div>
      <h4><MathText text={step.title} /></h4>
      <div className="explanation"><MathText text={step.explanation} originalImageUrl={originalImageUrl} /></div>
      {step.latex && <MathBlock latex={step.latex} />}
      {onAskStep && <button className="context-button" disabled={disabled} onClick={() => onAskStep(step, `${questionNumber ? `第${questionNumber}题 · ` : ""}第${index + 1}步：${step.title}`)}>这一步不懂</button>}
    </div>
  </li>)}</ol>;
}
function AnswerConclusion({ answer, selectedOptions, figures, originalImageUrl, onVerify, verificationDisabled, verificationLabel }: { answer: string; selectedOptions?: string[] | undefined; figures: AnswerCandidate['figures']; originalImageUrl?: string | undefined } & Actions) {
  return <div className="final-answer reading-card"><header className="answer-heading"><h3>{selectedOptions ? `答案：${selectedOptions.join('、')}` : '答案'}</h3>{onVerify && <button className="verify-button" disabled={verificationDisabled} onClick={onVerify}>{verificationLabel ?? '校验'}</button>}</header>
    {answer && <div className="answer-explanation"><MathText text={answer} originalImageUrl={originalImageUrl} /></div>}{figures?.map(figure => <AnswerFigure key={figure.id} figure={figure} />)}</div>;
}
export function AnswerContent({ candidate, subject, originalImageUrl, onAskStep, onAskQuestion, disabled, hideSteps = false, onVerify, verificationLabel, verificationDisabled }: { hideSteps?: boolean; candidate: AnswerCandidate; subject: string; originalImageUrl?: string | undefined } & Actions) {
  const sections = questionSections(candidate);
  if (!sections) return <>
    <AnswerConclusion answer={candidate.answer} selectedOptions={candidate.selectedOptions} figures={candidate.figures} originalImageUrl={originalImageUrl} onVerify={onVerify} verificationLabel={verificationLabel} verificationDisabled={verificationDisabled} />
    {!hideSteps && <details className="step-details reading-card"><summary aria-label="详细步骤"><span>详细步骤</span><span className="steps-expand">展开</span><span className="steps-collapse">收起</span></summary><TeachingSteps steps={candidate.steps} originalImageUrl={originalImageUrl} onAskStep={onAskStep} disabled={disabled} />
    {candidate.figures?.map(figure => <AnswerFigure key={figure.id} figure={figure} />)}</details>}
  </>;
  return <div className="question-sections">{sections.map(section => <section className="question-section" key={section.number} aria-label={`第${section.number}题解答`}>
    <header className="question-heading"><h3>第{section.number}题</h3><span>{subject}</span></header>
    {onAskQuestion && candidate.questions?.some(question => question.number === section.number) && <button className="context-button" disabled={disabled} onClick={() => onAskQuestion(section.number)}>追问这一题</button>}
    <AnswerConclusion answer={section.answer} selectedOptions={section.selectedOptions} figures={section.figures} originalImageUrl={originalImageUrl} onVerify={onVerify} verificationLabel={verificationLabel} verificationDisabled={verificationDisabled} />
    {!hideSteps && <details className="step-details reading-card"><summary aria-label="详细步骤"><span>详细步骤</span><span className="steps-expand">展开</span><span className="steps-collapse">收起</span></summary>
    <TeachingSteps steps={section.steps} originalImageUrl={originalImageUrl} questionNumber={section.number} onAskStep={onAskStep} disabled={disabled} />
    {section.figures.map(figure => <AnswerFigure key={figure.id} figure={figure} />)}</details>}
  </section>)}</div>;
}
