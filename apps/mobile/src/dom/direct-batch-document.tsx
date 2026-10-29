import { directBatchBlocks, directAnswerGroups, type DirectBatchContent } from '../local/direct-batch-content';

function markedText(text: string, highlights: { start: number; end: number }[] = []) {
  const parts = []; let offset = 0;
  for (const [index, range] of highlights.entries()) {
    parts.push(text.slice(offset, range.start), <mark key={index}>{text.slice(range.start, range.end)}</mark>); offset = range.end;
  }
  parts.push(text.slice(offset)); return parts;
}

export function DirectBatchDocument(props: DirectBatchContent) {
  return <main className="batch-print-document direct-print-document" data-testid="direct-print-document" data-pdf-content={props.mode}>
    {directBatchBlocks(props).map((block, index) => block.kind === 'image'
      ? <figure key={index}><img src={block.image} alt={block.label} /><figcaption>{block.label}</figcaption></figure>
      : block.kind === 'answer-table'
        ? <section key={index} className="direct-answer-table" aria-label="答案表"><h2>答案表</h2><table><thead><tr><th>题号</th><th>答案</th></tr></thead><tbody>{directAnswerGroups(block.entries).map(group => <tr key={group[0]!.key}><th scope="row">{group[0]!.ordinal}{group.length > 1 ? `–${group[group.length - 1]!.ordinal}` : ''}</th><td><div className="direct-answer-array"><span>[</span>{group.map((entry, position) => <span key={entry.key} className={entry.incorrect ? 'direct-print-incorrect' : undefined}><a aria-label={`第${entry.ordinal}题：${entry.answer}`} title={`第${entry.ordinal}题${entry.sourceNumber ? `（原题 ${entry.sourceNumber}）` : ''}`} href={`#direct-question-${entry.key}`}>{entry.choice ? <mark>{entry.answer}</mark> : entry.answer}{entry.incorrect ? ' ×' : ''}</a>{position < group.length - 1 ? ',' : ''}</span>)}<span>]</span></div></td></tr>)}</tbody></table></section>
        : <p key={index} id={block.anchor ? `direct-question-${block.anchor.key}` : undefined} className={`${block.heading ? 'direct-print-heading' : ''}${block.incorrect ? ' direct-print-incorrect' : ''}`}>{markedText(block.text, block.highlights)}</p>)}
  </main>;
}
