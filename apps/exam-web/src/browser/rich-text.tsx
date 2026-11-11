import { memo } from 'react';
import { normalizeMathDelimiters } from '@solveflow/contracts/math-text';
import { RichText as SharedRichText } from '@solveflow/web-ui/rich-text';

export const RichText = memo(function RichText({ text }: { text: string }) {
    return <SharedRichText text={normalizeMathDelimiters(text, { bareArithmetic: true })}/>;
});
