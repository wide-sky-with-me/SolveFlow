import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import katex from 'katex';
import 'katex/dist/katex.min.css';
export function RichText({ text }: { text: string }) {
  return <Markdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} components={{
    a: ({ href, children }) => <a href={href?.startsWith('https://') ? href : undefined} target="_blank" rel="noreferrer noopener">{children}</a>,
    img: () => null,
    code: ({ className, children }) => className?.includes('math') ? <span className={`math ${className.includes('math-display') ? 'display' : 'inline'}`} dangerouslySetInnerHTML={{ __html: katex.renderToString(String(children), { throwOnError: false, trust: false, displayMode: className.includes('math-display') }) }} /> : <code>{children}</code>,
  }}>{text}</Markdown>;
}
