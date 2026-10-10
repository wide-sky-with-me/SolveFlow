/** Sharing receives an already-authorized local image, never a model URL. */
export function imageShareData(uri: string) {
  if (uri.length > 5_592_432) throw new Error('题图过大，无法分享。');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri);
  if (!match) throw new Error('无法读取题图，请重新打开图片后重试。');
  const mimeType = match[1]!;
  return { mimeType, base64: match[2]!, extension: mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice(6) };
}
