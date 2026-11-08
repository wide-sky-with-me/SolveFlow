import { describe, expect, it } from 'vitest';
import { answerValue } from './answer-value.js';

describe('compact non-choice answers', () => {
  it('prefers the published structured value and never treats an option as a fill answer', () => {
    expect(answerValue({ answer: '由计算得到答案。', selectedOptions: null, responseValue: '29' })).toBe('29');
    expect(answerValue({ answer: '解释', selectedOptions: ['B'], responseValue: '29' })).toBeNull();
    expect(answerValue({ answer: '解释', selectedOptions: null, responseValue: '0' })).toBe('0');
  });
  it('reads explicit final result lines in historical answers without taking an explanation prefix', () => {
    expect(answerValue({ answer: '由公式得到两个根。\n\n**结果：$29$**', selectedOptions: null })).toBe('$29$');
    expect(answerValue({ answer: 'Compute the roots.\n\n**Result:** $-3/2$', selectedOptions: null })).toBe('$-3/2$');
    expect(answerValue({ answer: '分析数据。\n答案：sodium chloride', selectedOptions: null })).toBe('sodium chloride');
    expect(answerValue({ answer: '29', selectedOptions: [] })).toBe('29');
    expect(answerValue({ answer: '说明：初次答案：12\n\n最终答案：13', selectedOptions: null })).toBe('13');
  });
  it('does not guess a number from calculations or turn an essay into a highlighted answer', () => {
    expect(answerValue({ answer: 'By the formula, x = 2 + 3 = 5. This establishes the result.', selectedOptions: null })).toBeNull();
    expect(answerValue({ answer: '数据已经计算完毕，但是还需要补充表格才能确认。', selectedOptions: null })).toBeNull();
    expect(answerValue({ answer: '先试 $x=3$，再试 $x=4$。', selectedOptions: null })).toBeNull();
    expect(answerValue({ answer: '第一段论述。\n\n第二段论述。', selectedOptions: null })).toBeNull();
  });
  it('keeps fractions, units and plain text, and rejects ambiguous or excessive final blocks', () => {
    expect(answerValue({ answer: '结果：\\(\\frac{5}{3}\\)', selectedOptions: null })).toBe(String.raw`\(\frac{5}{3}\)`);
    expect(answerValue({ answer: '答案：12 cm', selectedOptions: null })).toBe('12 cm');
    expect(answerValue({ answer: 'Na2CO3', selectedOptions: null })).toBe('Na2CO3');
    expect(answerValue({ answer: '6.02e23', selectedOptions: null })).toBe('6.02e23');
    expect(answerValue({ answer: '答案：A\n答案：B', selectedOptions: null })).toBeNull();
    expect(answerValue({ answer: '**结果：' + 'a'.repeat(100) + '**', selectedOptions: null })).toBeNull();
  });
});
