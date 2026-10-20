export interface PdfRenderLifecycle {
  assertActive(): void;
  bindClone(doc: Document): void;
  completeRendering(): void;
  onDispose(cleanup: () => void): () => void;
  dispose(): void;
}

export interface PdfRenderLifecycleApi {
  createPdfRenderLifecycle(source: Document, check: () => void): PdfRenderLifecycle;
  yieldPdfRender(lifecycle: Pick<PdfRenderLifecycle, 'assertActive'>): Promise<void>;
}
