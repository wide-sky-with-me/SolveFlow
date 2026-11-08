import { Fragment } from 'react';
import { RichText } from './rich-text.js';

/** Summary values render only explicit math; ordinary text must not create links
 * or nested interactive controls inside a question-navigation button. */
export function AnswerValueText({ value }: { value: string }) {
    const pieces = value.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g);
    return <>{pieces.map((piece, index) => <Fragment key={index}>{index % 2 ? <RichText text={piece}/> : piece}</Fragment>)}</>;
}
