import { cropPixels, type ClientStore, type Crop } from '@solveflow/client';
import type { Photo } from './platform.types';
export const store: ClientStore = {
  async get(key) { return localStorage.getItem(`solveflow.${key}`); },
  async set(key, value) { localStorage.setItem(`solveflow.${key}`, value); },
  async remove(key) { localStorage.removeItem(`solveflow.${key}`); },
};
export async function pickPhoto(): Promise<Photo | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.setAttribute('aria-label', '从相册上传图片'); input.style.display = 'none'; document.body.append(input);
    input.oncancel = () => { input.remove(); resolve(null); };
    input.onchange = () => { const file = input.files?.[0]; input.remove(); if (!file) { resolve(null); return; } void samplePhoto(file).then(resolve, reject); };
    input.click();
  });
}
export async function recoverPhoto(): Promise<Photo | null> { return null; }
export async function samplePhoto(blob: Blob): Promise<Photo> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (blob.size > 10 * 1024 * 1024) throw new Error('图片超过10MB，请先裁切。');
  const bitmap = await createImageBitmap(blob);
  try { cropPixels({ left: 0, top: 0, right: 100, bottom: 100 }, bitmap.width, bitmap.height); return { uri: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height, owned: true, blob }; }
  finally { bitmap.close(); }
}
async function photoBlob(photo: Photo): Promise<Blob> {
  if (photo.blob) return photo.blob;
  if (photo.uri.startsWith('data:')) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(photo.uri);
    if (!match || match[2]!.length > 14_000_000) throw new Error('题图数据无效。');
    const bytes = Uint8Array.from(atob(match[2]!), value => value.charCodeAt(0));
    return new Blob([bytes], { type: match[1]! });
  }
  return (await fetch(photo.uri)).blob();
}
export async function transformPhoto(photo: Photo, crop?: Crop, rotate = false, maxDimension = 2048): Promise<Photo> {
  if (!Number.isInteger(maxDimension) || maxDimension < 1 || maxDimension > maxDimension) throw new Error('图片尺寸无效。');
  const source = await photoBlob(photo); const bitmap = await createImageBitmap(source);
  try {
    const box = cropPixels(crop ?? { left: 0, top: 0, right: 100, bottom: 100 }, bitmap.width, bitmap.height);
    const width = rotate ? box.height : box.width; const height = rotate ? box.width : box.height; const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器无法处理图片。');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.translate(canvas.width / 2, canvas.height / 2); if (rotate) context.rotate(Math.PI / 2);
    context.drawImage(bitmap, box.originX, box.originY, box.width, box.height, -box.width * scale / 2, -box.height * scale / 2, box.width * scale, box.height * scale);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片处理失败。')), 'image/jpeg', .92));
    return { uri: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, blob, owned: true };
  } finally { bitmap.close(); }
}
export async function photoBody(photo: Photo) { const blob = photo.blob ?? await (await fetch(photo.uri)).blob(); const form = new FormData(); form.append('file', blob, 'problem.jpg'); return form; }
export function releasePhoto(photo: Photo | null) { if (photo?.owned && photo.uri.startsWith('blob:')) URL.revokeObjectURL(photo.uri); }
export async function initialSession() { return new URLSearchParams(window.location.search).get('session') ?? await store.get('local-last-session'); }
export async function rememberSession(id: string | null) { window.history.replaceState(null, '', id ? `/?session=${id}` : '/'); if (id) await store.set('local-last-session', id); else await store.remove('local-last-session'); }
export async function photoData(photo: Photo): Promise<string> { const blob = photo.blob ?? await (await fetch(photo.uri)).blob(); if (blob.size > 4 * 1024 * 1024) throw new Error('图片超过4MB，请进一步裁切。'); return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('题图读取失败。')); reader.onerror = () => reject(new Error('题图读取失败。')); reader.readAsDataURL(blob); }); }
