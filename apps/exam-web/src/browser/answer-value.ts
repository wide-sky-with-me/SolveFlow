// Decision: .agents/notes/implemented/rendering/2026-11-07-non-choice-answer-values.md
type ValueSource = { answer: string; selectedOptions?: readonly string[] | null; responseValue?: string | undefined };
const label = '(最终(?:答案|结果)|final\\s+(?:answer|result)|答案|结果|answer|result)';
const markedLine = new RegExp('^' + label + '\\s*[:：]\\s*(.+)$', 'i');
const markedBold = new RegExp('\\*\\*\\s*' + label + '\\s*[:：]\\s*(.+?)\\*\\*', 'gi');
function compact(value: string) {
    const text = value.trim().replace(/^(?:\*\*|__)\s*/, '').replace(/(?:\*\*|__)$/, '').trim();
    return text && text.length <= 80 && !/[\r\n]/.test(text) ? text : null;
}
/** Prefer the published responseValue. Historical prose is only summarized when
 * it explicitly labels a result, or the entire answer is already a short value. */
export function answerValue(source: ValueSource): string | null {
    if (source.selectedOptions?.length) return null;
    if (source.responseValue) return compact(source.responseValue);
    const marked: { final: boolean; value: string }[] = [];
    function add(match: RegExpMatchArray) {
        const value = compact(match[2] ?? '');
        if (value) marked.push({ final: /^(?:最终|final)/i.test(match[1] ?? ''), value });
    }
    for (const line of source.answer.split(/\r?\n/)) {
        const match = line.trim().replace(/^#{1,6}\s+/, '').replace(/^(?:\*\*|__)/, '').match(markedLine);
        if (match) add(match);
    }
    for (const match of source.answer.matchAll(markedBold)) add(match);
    if (marked.length) {
        const finals = marked.filter(item => item.final), values = new Set((finals.length ? finals : marked).map(item => item.value));
        return values.size === 1 ? [...values][0] ?? null : null;
    }
    const whole = compact(source.answer);
    if (!whole) return null;
    if (/^[+−-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+−-]?\d+)?(?:\/[+−-]?\d+)?(?:\s*(?:%|°|[a-zA-Z]{1,8}(?:[²³]|\^\d)?))?$/u.test(whole)) return whole;
    if (/^\$[^$]+\$$/.test(whole) || /^\\\([\s\S]+\\\)$/.test(whole)) return whole;
    if (whole.length <= 48 && /^[a-zA-Z0-9]+(?:[ -][a-zA-Z0-9]+){0,4}$/.test(whole) && !/^(?:because|since|therefore|thus|the answer|we |by |given )/i.test(whole)) return whole;
    if (whole.length <= 12 && /^[\p{Script=Han}]+$/u.test(whole) && !/^(?:因为|所以|因此|根据|数据|计算|由)/.test(whole)) return whole;
    return null;
}
