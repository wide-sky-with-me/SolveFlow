import { expect, it } from "vitest";
import sharp from "sharp";
import { prepareVisualEvidence } from "./visual-evidence.js";
import { AnswerCandidateSchema } from "@solveflow/contracts/agent";
it("derives an exact source crop and labelled coordinate aid without modifying original bytes", async () => {
  const bytes = await sharp({ create: { width: 200, height: 100, channels: 3, background: "red" } }).composite([{ input: await sharp({ create: { width: 100, height: 100, channels: 3, background: "blue" } }).png().toBuffer(), left: 100, top: 0 }]).png().toBuffer();
  const before = Buffer.from(bytes);
  const candidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: "answer", problem: { text: "图示", subject: "math", uncertainties: [], illustrations: [{ id: "right", alt: "右半边", x: .5, y: 0, width: .5, height: 1 }] }, answer: "结论", steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] });
  const result = await prepareVisualEvidence({ bytes, mimeType: "image/png" }, candidate, new AbortController().signal);
  expect(result.images).toHaveLength(2); expect(result.description).toContain("3: 本题/right"); expect(result.description).toContain("200×100");
  const crop = result.images[1]!; const metadata = await sharp(crop.bytes).metadata(); expect(metadata.width).toBe(106); expect(metadata.height).toBe(100);
  const pixel = await sharp(crop.bytes).raw().toBuffer(); const center = 3 * 53; expect(pixel[center]).toBeLessThan(10); expect(pixel[center + 2]).toBeGreaterThan(240); expect(bytes).toEqual(before);
});
it("rejects invalid images and propagates cancellation before decoding", async () => {
  const image = { mimeType: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) };
  await expect(prepareVisualEvidence(image, undefined, new AbortController().signal)).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(prepareVisualEvidence(image, undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});
