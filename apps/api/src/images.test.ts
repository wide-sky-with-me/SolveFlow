import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeImage, readUpload } from "./images.js";
import { createIdentity } from "./auth.js";
import { createProbeImage } from "@solveflow/agent/application";
const signal = () => new AbortController().signal;
describe("private image ingestion", () => {
  it("decodes, orients, resizes and strips EXIF", async () => {
    const input = await sharp({ create: { width: 2400, height: 800, channels: 3, background: "white" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await normalizeImage(input, signal());
    expect(result.width).toBeLessThan(result.height); expect(result.height).toBe(2048);
    const meta = await sharp(result.data).metadata();
    expect(meta.format).toBe("jpeg"); expect(meta.exif).toBeUndefined(); expect(meta.orientation).toBeUndefined();
  });
  it.each([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from([255, 216, 255, 0]), Buffer.from("not an image")])("rejects malformed or executable formats", async bytes => {
    await expect(normalizeImage(bytes, signal())).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
  });
  it("rejects oversized bytes and pixel bombs before output", async () => {
    await expect(normalizeImage(new Uint8Array(10 * 1024 * 1024 + 1), signal())).rejects.toMatchObject({ code: "TOO_LARGE" });
    const large = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: "white" } }).png().toBuffer();
    await expect(normalizeImage(large, signal())).rejects.toBeDefined();
  });
  it("validates bytes regardless of MIME and rejects additional form fields", async () => {
    const form = new FormData(); form.set("file", new File(["<svg/>"], "a.jpg", { type: "image/jpeg" }));
    await expect(readUpload(new Request("http://local", { method: "POST", body: form }))).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
    form.set("ownerId", "someone-else");
    await expect(readUpload(new Request("http://local", { method: "POST", body: form }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("honors cancellation", async () => { await expect(normalizeImage(new Uint8Array(), AbortSignal.abort())).rejects.toBeDefined(); });
  it("rejects animated WebP", async () => {
    const pixels = Buffer.alloc(24); pixels.fill(255, 12);
    const bytes = await sharp(pixels, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    await expect(normalizeImage(bytes, signal())).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
  });
  it("rejects PNG animation control rather than accepting its default frame", async () => {
    const png = Buffer.from(createProbeImage()); const chunk = Buffer.alloc(20);
    chunk.writeUInt32BE(8, 0); chunk.write("acTL", 4); chunk.writeUInt32BE(2, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, 16)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 16);
    const bytes = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
    await expect(normalizeImage(bytes, signal())).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
  });
});
describe("anonymous identity", () => {
  it("authenticates signed cookies and rejects tampering and absent identity", () => {
    const identity = createIdentity("a".repeat(64)); const issued = identity.issue();
    expect(identity.verify(issued.cookie)).toBe(issued.id);
    expect(() => identity.verify(issued.cookie + "x")).toThrow(); expect(() => identity.verify(undefined)).toThrow();
    expect(() => createIdentity("b".repeat(64)).verify(issued.cookie)).toThrow();
  });
});
