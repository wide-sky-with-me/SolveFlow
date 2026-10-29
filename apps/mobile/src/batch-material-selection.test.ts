import { expect, it } from 'vitest';
import { materialTargetRange } from '../../../tests/helpers/material-target-range';
const targets = Array.from({ length: 6 }, (_, index) => ({ id: `saved-${index}`, position: index + 1, text: '' }));
it('maps ranges and repeated numbers to stable IDs in batch order', () => {
  expect(materialTargetRange('4,1-3、2，6', targets)).toEqual(['saved-0', 'saved-1', 'saved-2', 'saved-3', 'saved-5']);
});
it.each(['', '0', '2-1', '1-101', '1x2', '1,7', '1 2 invalid', '1'.repeat(1001)])('rejects the whole invalid target range %s', value => {
  expect(() => materialTargetRange(value, targets)).toThrow();
});
it('rejects missing positions rather than silently mapping a range to fewer recipients', () => {
  expect(() => materialTargetRange('1-3', targets.filter(target => target.position !== 2))).toThrow('第2张题图');
});
