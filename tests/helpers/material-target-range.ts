import { MAX_BATCH_PHOTOS } from '../../packages/contracts/src/local.js';
import type { MaterialTarget } from '../../apps/mobile/src/batch-material-selection.js';

/** Resolve visible photo numbers to immutable session IDs; reject the entire invalid range. */
export function materialTargetRange(text: string, targets: readonly MaterialTarget[]): string[] {
  if (text.length > 1000) throw new Error('题图序号输入过长。');
  const tokens = text.trim().split(/[,，、;；\s]+/).filter(Boolean);
  if (!tokens.length) throw new Error('请输入题图序号，例如1-5、8。');
  const selected = new Set<string>();
  for (const token of tokens) {
    const match = /^(\d{1,3})(?:[-–—至](\d{1,3}))?$/.exec(token);
    if (!match) throw new Error('题图序号格式无效，例如1-5、8。');
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > MAX_BATCH_PHOTOS) throw new Error('题图序号范围无效。');
    for (let number = first; number <= last; number++) {
      const target = targets.find(item => item.position === number);
      if (!target) throw new Error(`当前批次没有第${number}张题图。`);
      selected.add(target.id);
    }
  }
  return targets.filter(target => selected.has(target.id)).map(target => target.id);
}
