import { ReadingDetails } from './reading-state';
import { type AnswerCandidate } from "@solveflow/contracts/agent";
import { ChemistryContent, WritingContent } from './subject-content';
import { questionSections } from "@solveflow/contracts/http";
import { AnswerFigure } from "./answer-figure";
import { MathBlock, MathText } from "./math-text";

type Step = AnswerCandidate["steps"][number];
type Actions = { verificationNotRequested?: boolean | undefined; onVerify?: (() => void) | undefined; verificationLabel?: string | undefined; verificationDisabled?: boolean | undefined; disabled?: boolean | undefined; onAskStep?: ((step: Step, label: string) => void) | undefined; onAskQuestion?: ((number: number) => void) | undefined };
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
function AnswerConclusion({ answer, selectedOptions, parts, responseValue, response, writing, chemistry, stateKey, figures, originalImageUrl, onVerify, verificationDisabled, verificationLabel, verificationNotRequested }: { answer: string; writing?: AnswerCandidate['writing']; chemistry?: AnswerCandidate['chemistry']; stateKey: string; parts?: AnswerCandidate['parts']; responseValue?: string | undefined; response?: AnswerCandidate['problem']['response']; selectedOptions?: string[] | undefined; figures: AnswerCandidate['figures']; originalImageUrl?: string | undefined } & Actions) {
  const isWriting = response?.type === 'essay' || Boolean(writing);
  const heading = writing?.mode === 'feedback' ? '写作点评' : writing?.mode === 'revision' ? '修改稿' : isWriting ? '参考作文' : selectedOptions ? `答案：${selectedOptions.join('、')}` : '答案';
  return <div className="final-answer reading-card"><header className="answer-heading">
    <div className="answer-title"><h3>{!isWriting && selectedOptions ? <><span className="answer-heading-label">答案：</span><span className="answer-choice">{selectedOptions.join('、')}</span></> : heading}</h3></div>
    {(verificationNotRequested || onVerify) && <div className="answer-review">{verificationNotRequested && <span className="answer-verification-state">未校验</span>}{onVerify && <button className="verify-button" disabled={verificationDisabled} onClick={onVerify}>{verificationLabel ?? '校验'}</button>}</div>}
  </header>
    {responseValue && <p className="response-value">可填答案：<strong>{responseValue}</strong></p>}
    {isWriting ? <WritingContent answer={answer} writing={writing} response={response} stateKey={stateKey} /> : <div className="answer-explanation"><MathText text={answer} originalImageUrl={originalImageUrl} /></div>}
    {parts?.map(part => <section key={part.label} className="response-part"><h4>{part.label}</h4><MathText text={part.answer} originalImageUrl={originalImageUrl} /></section>)}
    {chemistry && <ChemistryContent chemistry={chemistry} />}{figures?.map(figure => <AnswerFigure key={figure.id} figure={figure} />)}</div>;
}
export function AnswerContent({ candidate, subject, originalImageUrl, onAskStep, onAskQuestion, disabled, hideSteps = false, onVerify, verificationLabel, verificationDisabled, verificationNotRequested }: { hideSteps?: boolean; candidate: AnswerCandidate; subject: string; originalImageUrl?: string | undefined } & Actions) {
  const sections = questionSections(candidate);
  if (!sections) return <>
    <AnswerConclusion stateKey="answer" writing={candidate.writing} chemistry={candidate.chemistry} answer={candidate.answer} parts={candidate.parts} responseValue={candidate.responseValue} response={candidate.problem.response} selectedOptions={candidate.selectedOptions} figures={candidate.figures} originalImageUrl={originalImageUrl} verificationNotRequested={verificationNotRequested} onVerify={onVerify} verificationLabel={verificationLabel} verificationDisabled={verificationDisabled} />
    {!hideSteps && <ReadingDetails stateKey="steps" className="step-details reading-card"><summary aria-label="详细步骤"><span>详细步骤</span><span className="steps-expand">展开</span><span className="steps-collapse">收起</span></summary><TeachingSteps steps={candidate.steps} originalImageUrl={originalImageUrl} onAskStep={onAskStep} disabled={disabled} />
    {candidate.figures?.map(figure => <AnswerFigure key={figure.id} figure={figure} />)}</ReadingDetails>}
  </>;
  return <div className="question-sections">{sections.map(section => <section className="question-section" key={section.number} aria-label={`第${section.number}题解答`}>
    <header className="question-heading"><h3>第{section.number}题</h3><span>{subject}</span></header>
    {onAskQuestion && candidate.questions?.some(question => question.number === section.number) && <button className="context-button" disabled={disabled} onClick={() => onAskQuestion(section.number)}>追问这一题</button>}
    <AnswerConclusion stateKey={`question:${section.number}`} writing={section.writing} chemistry={section.chemistry} answer={section.answer} parts={section.parts} responseValue={section.responseValue} response={section.problem?.response} selectedOptions={section.selectedOptions} figures={section.figures} originalImageUrl={originalImageUrl} verificationNotRequested={verificationNotRequested} onVerify={onVerify} verificationLabel={verificationLabel} verificationDisabled={verificationDisabled} />
    {!hideSteps && <ReadingDetails stateKey={`steps:${section.number}`} className="step-details reading-card"><summary aria-label="详细步骤"><span>详细步骤</span><span className="steps-expand">展开</span><span className="steps-collapse">收起</span></summary>
    <TeachingSteps steps={section.steps} originalImageUrl={originalImageUrl} questionNumber={section.number} onAskStep={onAskStep} disabled={disabled} />
    {section.figures.map(figure => <AnswerFigure key={figure.id} figure={figure} />)}</ReadingDetails>}
  </section>)}</div>;
}
