/** Holds one existing solve's JS lifecycle; never starts or replays a solve. */
export class BackgroundLifetime {
  private current: { id: string; done: Promise<void>; finish: () => void } | null = null;
  begin(id: string) {
    if (this.current) throw new Error('已有后台任务。');
    let finish = () => {};
    const done = new Promise<void>(resolve => { finish = resolve; });
    this.current = { id, done, finish };
  }
  wait(id: string): Promise<void> { return this.current?.id === id ? this.current.done : Promise.resolve(); }
  end(id: string) { if (this.current?.id === id) { const { finish } = this.current; this.current = null; finish(); } }
}
