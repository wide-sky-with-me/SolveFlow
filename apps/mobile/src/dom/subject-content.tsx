import { reactionLatex, responseWordCount, type AnswerCandidate, type Chemistry, type Writing } from '@solveflow/contracts/agent';
import { MathBlock, MathText } from './math-text';
import { ReadingDetails } from './reading-state';

export function WritingContent({ answer, writing, response, stateKey }: { answer: string; writing?: Writing | undefined; response?: AnswerCandidate['problem']['response']; stateKey: string }) {
  const isReview = writing?.mode === 'feedback';
  return <>
    {!isReview && <p className="subject-note">参考词数：{responseWordCount(answer)}{response?.wordLimit ? ` / ${response.wordLimit}` : ''}（按空白分词）</p>}
    <article className={isReview ? 'writing-review' : 'writing-article'} aria-label={isReview ? '写作点评' : '作文正文'}>
      {writing?.title && <h4 className="writing-title">{writing.title}</h4>}
      <MathText text={answer} />
    </article>
    {writing?.feedback?.length && <ReadingDetails stateKey={`writing:${stateKey}`} className="writing-feedback"><summary>段落点评 · {writing.feedback.length}</summary>
      <ul>{writing.feedback.map((note, index) => <li key={index}>{note.paragraph && <span className="writing-paragraph">第 {note.paragraph} 段</span>}<MathText text={note.comment} /></li>)}</ul>
    </ReadingDetails>}
  </>;
}

export function ChemistryContent({ chemistry }: { chemistry: Chemistry }) {
  return <section className="chemistry-reactions" aria-label="化学反应式">
    <h4>反应式</h4>{chemistry.reactions.map((reaction, index) => <MathBlock key={index} latex={reactionLatex(reaction)} />)}
    <p className="subject-note">已检查所列反应式的原子与电荷守恒；反应条件和结论仍需核对。</p>
  </section>;
}
