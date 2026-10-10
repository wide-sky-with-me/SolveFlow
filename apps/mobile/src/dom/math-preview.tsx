'use dom';
import { z } from 'zod';
import { MAX_USER_MESSAGE_CHARACTERS } from '@solveflow/contracts/agent';
import { MathText } from './math-text';
import '../../.generated/katex.css';
import './answer.css';
import './theme.css';
import { useDocumentTheme, type DocumentTheme } from './document-theme';

export default function MathPreview({ theme = 'light', previewPayload, mode = 'preview' }: { dom?: import('expo/dom').DOMProps; previewPayload: string; theme?: DocumentTheme; mode?: 'preview' | 'message' }) {
  useDocumentTheme(theme);
  const limit = mode === 'message' ? MAX_USER_MESSAGE_CHARACTERS : 2000;
  const text = z.string().max(limit).parse(decodeURIComponent(z.string().max(limit * 12).parse(previewPayload)));
  return <section className="answer-document math-preview" aria-label={mode === 'message' ? '对话内容' : '题干公式预览'}><div className="reading-card"><MathText text={text || '输入题干后在这里预览'} /></div></section>;
}
