"use client";
import { useId, useState } from "react";
import { originalIllustrationBounds, type ProblemStatement as Statement } from "@solveflow/contracts/agent";
import { MathText } from "./math-text";
type ImageSize = { width: number; height: number };
export function ProblemStatement({ problem, image, imageSize, onViewOriginal, onCorrect, onRegenerate, onHistory, disabled }: { onHistory?: (() => void) | undefined; onRegenerate?: (() => void) | undefined; onCorrect?: (() => void) | undefined; disabled?: boolean | undefined; onViewOriginal?: (() => void) | undefined; problem: Statement; image?: string | undefined; imageSize?: ImageSize | undefined }) {
  const content = problem;
  return <section className="problem-statement reading-card" aria-label="题目原文"><header className="problem-heading"><h4>{problem.sourceNumber ? `题目 · 原题号 ${problem.sourceNumber}` : '题目'}</h4><div className="problem-actions">{onRegenerate && <button type="button" className="regenerate-button" disabled={disabled} onClick={onRegenerate}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></svg>重新解答</button>}{image && onViewOriginal && <button className="original-link" onClick={onViewOriginal}>查看原图</button>}{onHistory && <button className="original-link" onClick={onHistory}>历史解答</button>}</div></header><div className={`problem-layout${problem.illustrations?.length ? " with-illustrations" : ""}`}>
    <div className="problem-text"><MathText text={content.text} originalImageUrl={image} />{content.options && <ol className="choice-options" aria-label="选项">{content.options.map(option => <li key={option.label}><span className="choice-label">{option.label}</span><div className="choice-text"><MathText text={option.text} originalImageUrl={image} /></div></li>)}</ol>}{!!problem.uncertainties.length && <div className="unverified-note"><strong>识别待确认</strong>{problem.uncertainties.map(item => <MathText key={item} text={item} />)}<p>请查看原图核对，可用“更正题干”补全条件后重新解答，或在下方补充说明。</p></div>}</div>
    {!!problem.illustrations?.length && <div className="original-illustrations">{problem.illustrations.map(crop => image && imageSize ? <OriginalIllustration key={crop.id} crop={crop} image={image} size={imageSize} /> : <p key={crop.id}>原题图暂不可用：{crop.alt}。请查看上方原图。</p>)}</div>}
  </div>{onCorrect && <button className="context-button correction-link" disabled={disabled} onClick={onCorrect}>识别有误？更正题干</button>}</section>;
}
function OriginalIllustration({ crop, image, size }: { crop: NonNullable<Statement["illustrations"]>[number]; image: string; size: ImageSize }) {
  const bounds = originalIllustrationBounds(crop);
  const id = useId(); const [zoomed, setZoomed] = useState(false); const [failed, setFailed] = useState(false);
  return <figure className="original-illustration"><figcaption><strong>原题图</strong><span>{crop.alt}</span></figcaption>
    {failed ? <p role="status">原题图加载失败，请刷新页面或查看上方原图。</p> : <>
      <button className="figure-zoom" type="button" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>{zoomed ? "收起原题图" : "放大原题图"}</button>
      <div className={`original-crop-viewport${zoomed ? " zoomed" : ""}`} tabIndex={0} role="region" aria-label="原题局部图，可放大滚动">
        <svg viewBox={`${bounds.x * size.width} ${bounds.y * size.height} ${bounds.width * size.width} ${bounds.height * size.height}`} role="img" aria-labelledby={id}>
          <title id={id}>{crop.alt}</title><image href={image} x={0} y={0} width={size.width} height={size.height} onError={() => setFailed(true)} />
        </svg>
      </div>
    </>}
  </figure>;
}
