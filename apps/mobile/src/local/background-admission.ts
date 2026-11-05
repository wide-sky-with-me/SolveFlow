/** Foreground changes cannot resume dispatch while expiration cleanup is still saving terminal runs. */
export class BackgroundAdmission {
  private foreground = true;
  private expiring = 0;
  constructor(private readonly pause: (paused: boolean) => void, private readonly cancel: (id: string) => Promise<void>) {}
  private update() { this.pause(!this.foreground || this.expiring > 0); }
  setForeground(value: boolean) { this.foreground = value; this.update(); }
  async expire(ids: readonly string[]) {
    this.expiring++; this.update();
    try { await Promise.all(ids.map(id => this.cancel(id))); }
    finally { this.expiring--; this.update(); }
  }
}
