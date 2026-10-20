const MINIMUM_POINTS = 8;

/** Fit the whole question rather than splitting or clipping it across sheets. */
export function fitBatchPrintQuestionPage(page: HTMLElement) {
  const body = page.querySelector<HTMLElement>('.print-page-body');
  const inner = page.querySelector<HTMLElement>('.print-page-inner');
  const view = page.ownerDocument.defaultView;
  if (!body || !inner || !view) throw new Error('单题页面结构不完整。');
  inner.style.transform = '';
  const images = [...inner.querySelectorAll<HTMLImageElement>('img')];
  for (const image of images) image.style.maxHeight = '';
  const available = body.clientHeight - 2; const width = body.clientWidth - 2;
  const fontPoints = parseFloat(view.getComputedStyle(inner).fontSize) * 72 / 96;
  if (!Number.isFinite(fontPoints) || fontPoints <= 0 || width <= 0) throw new Error('单题页面字号或宽度不完整。');
  const minimumScale = Math.min(1, MINIMUM_POINTS / fontPoints);
  const measure = () => Math.min(1, available / Math.max(inner.scrollHeight, 1), width / Math.max(inner.scrollWidth, 1));
  let scale = measure();
  for (let attempt = 0; attempt < 4 && scale < minimumScale && images.length; attempt++) {
    for (const image of images) image.style.maxHeight = `${Math.max(48, image.getBoundingClientRect().height * .8)}px`;
    scale = measure();
  }
  if (!Number.isFinite(scale) || available <= 0 || scale < minimumScale) throw new Error(`第${page.dataset.pdfQuestion}题内容过长，请调整图示或重复材料后再按一题一页导出。`);
  inner.style.transformOrigin = 'top left';
  inner.style.transform = `scale(${scale})`;
  page.dataset.pdfFit = String(scale);
}

export function fitBatchPrintQuestionPages(root: ParentNode) {
  for (const page of root.querySelectorAll<HTMLElement>('[data-pdf-question]')) fitBatchPrintQuestionPage(page);
}
