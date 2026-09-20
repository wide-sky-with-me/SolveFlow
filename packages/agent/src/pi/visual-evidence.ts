import sharp from "sharp";
import { NormalizedImageSchema, originalIllustrationBounds, type NormalizedImage, type AnswerCandidate } from "@solveflow/contracts/agent";
/** Server-derived aids only; original image is still supplied separately and unchanged. */
export async function prepareVisualEvidence(image: NormalizedImage, candidate: AnswerCandidate | undefined, signal: AbortSignal): Promise<{ images: NormalizedImage[]; description: string }> {
  signal.throwIfAborted();
  const source = () => sharp(image.bytes, { limitInputPixels: 2048 * 2048, failOn: "warning" }).timeout({ seconds: 3 });
  const { width, height } = await source().metadata();
  if (!width || !height || width > 2048 || height > 2048) throw new Error("INVALID_IMAGE_DIMENSIONS");
  const font = Math.max(12, Math.round(Math.min(width, height) / 35));
  const marks = Array.from({ length: 9 }, (_, i) => {
    const value = (i + 1) / 10; const x = width * value; const y = height * value;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${height}"/><line x1="0" y1="${y}" x2="${width}" y2="${y}"/><text x="${x + 2}" y="${font}">x=${value}</text><text x="2" y="${y - 2}">y=${value}</text>`;
  }).join("");
  // Only trusted numeric dimensions and fixed labels enter SVG, never student text.
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g stroke="#c93e64" stroke-width="1" stroke-opacity="0.5" fill="#a01238" font-size="${font}" font-family="sans-serif">${marks}</g></svg>`);
  const guide = await source().composite([{ input: overlay }]).jpeg({ quality: 80 }).toBuffer(); signal.throwIfAborted();
  const images = [NormalizedImageSchema.parse({ bytes: guide, mimeType: "image/jpeg" })];
  const crops = candidate ? (candidate.questions ? candidate.questions.flatMap(question => (question.problem?.illustrations ?? []).map(crop => ({ ...crop, question: question.number }))) : (candidate.problem.illustrations ?? []).map(crop => ({ ...crop, question: undefined }))) : [];
  const labels: string[] = [];
  let bytes = guide.byteLength;
  for (const crop of crops) {
    signal.throwIfAborted();
    const bounds = originalIllustrationBounds(crop);
    const left = Math.floor(bounds.x * width); const top = Math.floor(bounds.y * height);
    const cutWidth = Math.max(1, Math.min(width - left, Math.ceil((bounds.x + bounds.width) * width) - left));
    const cutHeight = Math.max(1, Math.min(height - top, Math.ceil((bounds.y + bounds.height) * height) - top));
    const cut = await source().extract({ left, top, width: cutWidth, height: cutHeight }).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    signal.throwIfAborted(); bytes += cut.byteLength; if (bytes > 4 * 1024 * 1024) throw new Error("VISUAL_EVIDENCE_LIMIT");
    images.push(NormalizedImageSchema.parse({ bytes: cut, mimeType: "image/jpeg" })); labels.push(`${images.length + 1}: ${crop.question === undefined ? "本题" : `第${crop.question}题`}/${crop.id}`);
  }
  return { images, description: `图片1是未经绘制修改的授权原图，尺寸${width}×${height}。图片2是同一原图的坐标辅助副本：红色网格是服务端叠加，每格0.1，不是原题条件；x向右、y向下。原题裁框坐标必须相对图片1整个宽高，不能相对某个图形。${labels.length ? `后续图片是服务端按候选坐标增加3%原图宽高留白后实际裁出的画面（${labels.join("；")}），即前端将展示的区域。逐一检查图形、顶点和标记是否完整；若任何内容被截断或框到别题，必须fail并建议扩大/修正边界，不可只核对文字。` : "先对照网格确定图形最左/上/右/下的位置，含标签留白后再计算width=右-左、height=下-上。"}` };
}
