export async function preparePhoto(file: File): Promise<{ image: string; width: number; height: number }> {
  if (!file.type.startsWith('image/') || !file.size || file.size > 24 * 1024 * 1024) throw new Error('请选择24MB以内的图片。');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('无法读取这张图片，请改用JPEG、PNG或截图。'); }
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (bitmap.width * bitmap.height > 64000000 || !bitmap.width || !bitmap.height) throw new Error('图片分辨率过高，请先截图或缩小。');
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('当前浏览器无法处理图片。');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', .88); if (image.length > Math.ceil(4 * 1024 * 1024 * 4 / 3) + 32) throw new Error('图片过大，请缩小后重试。');
    return { image, width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}
