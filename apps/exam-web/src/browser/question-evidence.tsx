import type { ProblemStatement, SolveOutcome } from '@solveflow/contracts/agent';
import { Feedback } from '@solveflow/web-ui/feedback';
import './question-evidence.css';

/** Evidence warnings remain visible beside the answer, including when no choice was returned. */
export function QuestionEvidence({ problem, outcome, onSupplement, disabled = false, actionLabel = '补图并重新解答' }: {
    problem: ProblemStatement | null;
    outcome: SolveOutcome | null;
    onSupplement?: () => void;
    disabled?: boolean;
    actionLabel?: string;
}) {
    const candidate = outcome && 'candidate' in outcome ? outcome.candidate : null;
    if (candidate?.kind === 'clarification' && candidate.refusalReason) {
        return <section aria-label="本次请求说明">{candidate.clarificationQuestions.map(text => <p key={text}>{text}</p>)}</section>;
    }
    const clarification = candidate?.kind === 'clarification';
    const incomplete = problem?.optionsComplete === false;
    const verification = outcome?.status === 'completed' ? outcome.verification : null;
    const uncertain = !!verification?.evidenceStatus && verification.evidenceStatus !== 'sufficient';
    const messages = [...new Set([
        ...(clarification ? candidate.clarificationQuestions : []),
        ...(problem?.uncertainties ?? []),
        ...(verification?.issues.filter(issue => issue.code === 'INSUFFICIENT_EVIDENCE').map(issue => issue.message) ?? []),
    ].map(text => text.trim()).filter(Boolean))];
    if (!clarification && !incomplete && !uncertain && !messages.length) return null;
    return <section aria-label="题图提示">
      <Feedback tone="warning" className="question-evidence">
        <h4>{clarification ? '需要补图' : incomplete ? '选项未拍全' : '题图待确认'}</h4>
        {incomplete && !clarification && <p>当前结论尚未匹配完整选项，请补拍全部选项后重新解答。</p>}
        {messages.map(text => <p key={text}>{text}</p>)}
        {!messages.length && (!incomplete || clarification) && <p>请补拍清晰、完整的题干、图表和选项。</p>}
        {onSupplement && <button type="button" className="secondary" disabled={disabled} onClick={onSupplement}>{actionLabel}</button>}
      </Feedback>
    </section>;
}
