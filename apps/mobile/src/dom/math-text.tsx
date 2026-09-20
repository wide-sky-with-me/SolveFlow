import { memo, useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathDelimiters } from "@solveflow/client";

function Formula({ latex, inline = false }: { latex: string; inline?: boolean }) {
  if (latex.length > 2000) return <span>公式过长，暂不显示。</span>;
  let html: string;
  try { html = katex.renderToString(latex, { displayMode: !inline, throwOnError: true, trust: false, strict: "error", maxExpand: 100, maxSize: 20, output: "htmlAndMathml" }); }
  catch { return <code className="math-fallback">{latex}</code>; }
  return inline ? <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />
    : <DisplayFormula html={html} />;
}
/** Fit modest overflow without making long formulas unreadably small. */
function DisplayFormula({ html }: { html: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const outer = viewport.current; const inner = content.current;
    if (!outer || !inner) return;
    let lastWidth = -1; let disposed = false;
    const measure = (force = false) => {
      const width = outer.clientWidth - 4;
      if (disposed || width <= 0 || (!force && width === lastWidth)) return;
      lastWidth = width; inner.style.fontSize = '1em';
      const natural = inner.getBoundingClientRect().width;
      inner.style.fontSize = `${Math.max(.82, Math.min(1, width / Math.max(1, natural)))}em`;
      setOverflow(inner.getBoundingClientRect().width > width + 1);
    };
    const observer = new ResizeObserver(() => measure()); observer.observe(outer);
    measure(); void document.fonts.ready.then(() => measure(true));
    return () => { disposed = true; observer.disconnect(); };
  }, [html]);
  return <div className="formula-shell"><div ref={viewport} className="math-block" tabIndex={0} aria-label="公式，可横向滚动"><div ref={content} className="formula-content" dangerouslySetInnerHTML={{ __html: html }} /></div>{overflow && <span className="formula-hint">左右滑动查看完整公式</span>}</div>;
}
export function MathBlock({ latex }: { latex: string }) { return <Formula latex={latex} />; }
export const MathText = memo(function MathText({ text, originalImageUrl }: { text: string; originalImageUrl?: string | undefined }) {
  const image = originalImageUrl && originalImageUrl.length <= 6 * 1024 * 1024 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(originalImageUrl) ? originalImageUrl : undefined;
  // Stable component identities preserve loaded images and formula scroll state
  // when the enclosing answer reports a new height or verification status.
  const components = useMemo<Components>(() => ({
      a: ({ children }) => <span>{children}</span>,
      img: ({ src, alt }) => src === image && image ? <img className="answer-image" src={image} alt={alt || "原题图片"} loading="lazy" /> : <span className="image-unavailable">{alt || "图片"}（无可用的授权图片）</span>,
      pre: ({ children }) => <div className="answer-code">{children}</div>,
      code: ({ className, children }) => /(?:^|\s)math-(?:inline|display)(?:\s|$)/.test(className ?? "")
        ? <Formula latex={String(children).replace(/\n$/, "")} inline={className?.includes("math-inline") ?? false} />
        : <code className={className}>{children}</code>,
      table: ({ children }) => <div className="answer-table-scroll" tabIndex={0} aria-label="表格，可横向滚动"><table>{children}</table></div>,
    }), [image]);
  return <div className="answer-markdown"><Markdown skipHtml remarkPlugins={[remarkGfm, remarkMath]}
    urlTransform={(url, key) => key === "src" && url === "attachment:original" && image ? image : ""}
    components={components}>{normalizeMathDelimiters(text)}</Markdown></div>;
});
