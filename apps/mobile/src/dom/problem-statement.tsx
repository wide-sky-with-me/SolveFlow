"use client";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { originalIllustrationBounds, type ProblemStatement as Statement } from "@solveflow/contracts/agent";
import { MathText } from "./math-text";
import { imageLongPress } from '../components/image-long-press';
type ImageSize = { width: number; height: number };
export function ProblemStatement({ problem, image, imageSize, onViewOriginal, onCorrect, onRegenerate, onHistory, onDiagnostics, disabled, onShareOriginal }: { onDiagnostics?: (() => void) | undefined; onShareOriginal?: (() => Promise<void>) | undefined; onHistory?: (() => void) | undefined; onRegenerate?: (() => void) | undefined; onCorrect?: (() => void) | undefined; disabled?: boolean | undefined; onViewOriginal?: (() => void) | undefined; problem: Statement; image?: string | undefined; imageSize?: ImageSize | undefined }) {
  const content = problem;
  return <section className="problem-statement reading-card" aria-label="题目原文"><header className="problem-heading">
    <div className="problem-title"><h4>{problem.sourceNumber ? `题目 · 原题号 ${problem.sourceNumber}` : '题目'}</h4>
      {onCorrect && <button type="button" className="problem-tool-button" aria-label="识别有误？更正题干" disabled={disabled} onClick={onCorrect}>更正题干</button>}
    </div>
    <div className="problem-actions">{onDiagnostics && <button type="button" className="problem-tool-button" aria-label="查看解题诊断" onClick={onDiagnostics}>诊断</button>}{onRegenerate && <button type="button" className="regenerate-button" disabled={disabled} onClick={onRegenerate}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></svg>重新解答</button>}{onHistory && <button className="original-link" onClick={onHistory}>历史解答</button>}</div></header><div className={`problem-layout${problem.illustrations?.length ? " with-illustrations" : ""}`}>
    <div className="problem-text"><MathText text={content.text} originalImageUrl={image} />{content.options && <ol className="choice-options" aria-label="选项">{content.options.map(option => <li key={option.label}><span className="choice-label">{option.label}</span><div className="choice-text"><MathText text={option.text} originalImageUrl={image} /></div></li>)}</ol>}{!!problem.uncertainties.length && <div className="unverified-note"><strong>识别待确认</strong>{problem.uncertainties.map(item => <MathText key={item} text={item} />)}<p>请查看原图核对，可用“更正题干”补全条件后重新解答，或在下方补充说明。</p></div>}</div>
    {!!problem.illustrations?.length && <div className="original-illustrations">{problem.illustrations.map(crop => image && imageSize ? <OriginalIllustration key={crop.id} crop={crop} image={image} size={imageSize} onViewOriginal={onViewOriginal} onShareOriginal={onShareOriginal} /> : <p key={crop.id}>原题图暂不可用：{crop.alt}。请点击题目图片查看。</p>)}</div>}
  </div>{image && onViewOriginal && (!problem.illustrations?.length || !imageSize) && <PhotoButton className="original-photo-preview" onView={onViewOriginal} onShare={onShareOriginal}><img src={image} alt="题目原照片" draggable={false} /></PhotoButton>}</section>;
}
function OriginalIllustration({ crop, image, size, onViewOriginal, onShareOriginal }: { onShareOriginal?: (() => Promise<void>) | undefined; onViewOriginal?: (() => void) | undefined; crop: NonNullable<Statement["illustrations"]>[number]; image: string; size: ImageSize }) {
  const bounds = originalIllustrationBounds(crop);
  const id = useId(); const [failed, setFailed] = useState(false);
  return <figure className="original-illustration"><figcaption><strong>原题图</strong><span>{crop.alt}</span></figcaption>
    <PhotoButton className="original-crop-viewport original-image-preview" onView={onViewOriginal} onShare={onShareOriginal}>
      {failed ? <span role="status">原题图加载失败，点此打开原照片。</span> : <svg viewBox={`${bounds.x * size.width} ${bounds.y * size.height} ${bounds.width * size.width} ${bounds.height * size.height}`} role="img" aria-labelledby={id}>
        <title id={id}>{crop.alt}</title><image href={image} x={0} y={0} width={size.width} height={size.height} onError={() => setFailed(true)} />
      </svg>}
    </PhotoButton>
  </figure>;
}

function PhotoButton({ children, className, onView, onShare }: { children: ReactNode; className: string; onView?: (() => void) | undefined; onShare?: (() => Promise<void>) | undefined }) {
  const press = useMemo(() => imageLongPress(() => void onShare?.()), [onShare]);
  useEffect(() => () => press.cancel(), [press]);
  return <button type="button" className={className} aria-label="查看题目图片" disabled={!onView} style={{ touchAction: 'pan-y', userSelect: 'none', WebkitTouchCallout: 'none' }}
    onPointerDown={event => { if (!event.isPrimary || event.button !== 0) { press.cancel(); return; } press.start(event.clientX, event.clientY); }}
    onPointerMove={event => press.move(event.clientX, event.clientY)} onPointerUp={() => press.end()} onPointerCancel={press.cancel} onPointerLeave={press.cancel}
    onContextMenu={event => event.preventDefault()} onClick={() => { if (!press.end()) onView?.(); }}>{children}</button>;
}
