import { MAX_BATCH_PRINT_COPIES, MAX_BATCH_PRINT_REMARK_CHARACTERS, type BatchPrintCopyRequest } from '@solveflow/contracts/local';

type IntegerDraft = { text: string; value: number };
export type PrintCopyField = 'count' | number;
export type PrintCopyDrafts = { count?: IntegerDraft; incorrect?: Partial<Record<number, IntegerDraft>>; remarks?: Partial<Record<number, string>> };
export type PrintCopyState = { requests: BatchPrintCopyRequest[]; drafts: PrintCopyDrafts };

export function printCopyInteger(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

export function parsePrintCopyDrafts(state: PrintCopyState, total: number, baselineWrong: number) {
  const count = state.drafts.count === undefined ? state.requests.length : printCopyInteger(state.drafts.count.text, 1, MAX_BATCH_PRINT_COPIES);
  const invalidCount = count === null || count > MAX_BATCH_PRINT_COPIES;
  const length = Math.min(MAX_BATCH_PRINT_COPIES, count ?? state.drafts.count?.value ?? state.requests.length);
  const invalidIncorrect: number[] = [];
  const requests = Array.from({ length }, (_, index) => {
    const previous = state.requests[index] ?? { correct: total - baselineWrong, incorrect: baselineWrong };
    const draft = state.drafts.incorrect?.[index];
    const value = draft === undefined ? previous.incorrect : printCopyInteger(draft.text, 0, total);
    if (value === null) invalidIncorrect.push(index);
    const incorrect = value ?? draft?.value ?? previous.incorrect;
    const remark = state.drafts.remarks?.[index] ?? previous.remark;
    return { correct: total - incorrect, incorrect, ...(remark === undefined ? {} : { remark }) };
  });
  const firstInvalid = invalidIncorrect[0];
  const error = invalidCount ? `导出份数需为 1 至 ${MAX_BATCH_PRINT_COPIES} 的整数。` : firstInvalid !== undefined ? `第 ${firstInvalid + 1} 份错题数需为 0 至 ${total} 的整数。` : '';
  return { requests, invalidCount, invalidIncorrect, error };
}

export function editPrintCopyDraft(state: PrintCopyState, field: PrintCopyField, text: string | null, total: number, baselineWrong: number): PrintCopyState {
  if (field !== 'count' && (!Number.isInteger(field) || field < 0 || field >= MAX_BATCH_PRINT_COPIES)) return state;
  const drafts: PrintCopyDrafts = { ...state.drafts };
  const previous = field === 'count' ? state.requests.length : drafts.incorrect?.[field]?.value ?? state.requests[field]?.incorrect ?? baselineWrong;
  const bounded = text?.slice(0, 8);
  const draft = bounded === undefined ? undefined : { text: bounded, value: printCopyInteger(bounded, field === 'count' ? 1 : 0, field === 'count' ? MAX_BATCH_PRINT_COPIES : total) ?? previous };
  if (field === 'count') { if (draft === undefined) delete drafts.count; else drafts.count = draft; }
  else {
    drafts.incorrect = { ...drafts.incorrect };
    if (draft === undefined) delete drafts.incorrect[field]; else drafts.incorrect[field] = draft;
  }
  const result = parsePrintCopyDrafts({ requests: state.requests, drafts }, total, baselineWrong);
  // Retain bounded per-copy text and valid values through smaller intermediate counts.
  return { requests: result.requests, drafts };
}


export function editPrintCopyRemark(state: PrintCopyState, index: number, text: string, total: number, baselineWrong: number): PrintCopyState {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_BATCH_PRINT_COPIES) return state;
  const drafts = { ...state.drafts, remarks: { ...state.drafts.remarks, [index]: text.slice(0, MAX_BATCH_PRINT_REMARK_CHARACTERS) } };
  return { requests: parsePrintCopyDrafts({ requests: state.requests, drafts }, total, baselineWrong).requests, drafts };
}
