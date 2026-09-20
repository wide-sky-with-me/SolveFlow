import sharp from "sharp";
import { createHash } from "node:crypto";
import { ApiError } from "@solveflow/contracts/http";
import { boundedBody } from "./bounded-body.js";
sharp.cache(false); sharp.concurrency(1);
export async function normalizeImage(bytes: Uint8Array, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) throw new ApiError("TOO_LARGE");
  const buffer = Buffer.from(bytes);
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const webp = buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (!png && !jpeg && !webp) throw new ApiError("UNSUPPORTED_IMAGE");
  if (png) {
    // libvips can expose only the default frame of APNG. Reject its animation
    // control chunks before decoding, rather than silently discarding frames.
    let offset = 8; let chunks = 0;
    while (offset + 12 <= buffer.length) {
      if (++chunks > 4096) throw new ApiError("TOO_LARGE");
      const length = buffer.readUInt32BE(offset); const type = buffer.toString("ascii", offset + 4, offset + 8);
      if (length > buffer.length - offset - 12 || ["acTL", "fcTL", "fdAT"].includes(type)) throw new ApiError("UNSUPPORTED_IMAGE");
      offset += length + 12; if (type === "IEND") break;
    }
  }
  try {
    const metadata = await sharp(buffer, { limitInputPixels: 20_000_000, failOn: "warning" }).metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000) throw new ApiError("TOO_LARGE");
    if ((metadata.pages ?? 1) > 1 || !["jpeg", "png", "webp"].includes(metadata.format)) throw new ApiError("UNSUPPORTED_IMAGE");
    // Re-encode decoded pixels. Metadata is removed unless explicitly preserved.
    const { data, info } = await sharp(buffer, { limitInputPixels: 20_000_000, failOn: "warning" }).autoOrient().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true });
    signal.throwIfAborted();
    if (data.length > 4 * 1024 * 1024) throw new ApiError("TOO_LARGE");
    return { data: new Uint8Array(data), bytes: data.length, width: info.width, height: info.height, hash: createHash("sha256").update(data).digest("hex") };
  } catch (error) { if (signal.aborted) throw new ApiError("INVALID_INPUT"); if (error instanceof ApiError) throw error; throw new ApiError("UNSUPPORTED_IMAGE"); }
}
export async function readUpload(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data;")) throw new ApiError("INVALID_INPUT");
  const body = await boundedBody(request, 11 * 1024 * 1024);
  let form: FormData;
  try { form = await new Response(body, { headers: { "content-type": type } }).formData(); } catch { throw new ApiError("INVALID_INPUT"); }
  const entries = [...form.entries()]; const file = form.get("file");
  if (entries.length !== 1 || !(file instanceof File)) throw new ApiError("INVALID_INPUT");
  return normalizeImage(new Uint8Array(await file.arrayBuffer()), request.signal);
}
