/** Bound JSON before validation/transforms and again before transport serialization.
 * This is not a replacement for bounded HTTP/provider receive buffers. */
export function assertBoundedJson(input: unknown): void {
  let bytes = 0;
  let nodes = 0;
  const ancestors = new Set<object>();
  const deny = (): never => { throw new Error("JSON_INPUT_LIMIT"); };
  const add = (count: number) => { bytes += count; if (bytes > 32 * 1024) deny(); };
  const stringBytes = (value: string) => {
    if (value.length > 8192) deny();
    add(Buffer.byteLength(JSON.stringify(value), "utf8"));
  };
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 2048 || depth > 16) deny();
    if (value === null) { add(4); return; }
    if (typeof value === "string") { stringBytes(value); return; }
    if (typeof value === "boolean") { add(value ? 4 : 5); return; }
    if (typeof value === "number") { if (!Number.isFinite(value)) deny(); add(String(value).length); return; }
    if (typeof value !== "object") return deny();
    if (ancestors.has(value) || Object.getOwnPropertySymbols(value).length) deny();
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) deny();
    if (array && value.length > 2048) deny();
    ancestors.add(value);
    add(2);
    let count = 0;
    for (const key of Object.keys(value)) {
      if (++count > 2048) deny();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return deny();
      if (array) { if (key !== String(count - 1)) deny(); }
      else { stringBytes(key); add(1); }
      if (count > 1) add(1);
      visit(descriptor.value, depth + 1);
    }
    if (array && count !== value.length) deny();
    ancestors.delete(value);
  };
  visit(input, 0);
}
