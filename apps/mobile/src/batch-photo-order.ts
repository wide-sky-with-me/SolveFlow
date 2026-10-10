import type { Photo } from './platform.types';

export type ImportPhoto = { id: number; photo: Photo; fileName: string; timestamp?: number; timeSource?: 'modified' | 'filename' };
export type PhotoOrder = 'filename' | 'time';
const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** No EXIF access: only a fully validated timestamp explicitly present in a name. */
export function fileNameTime(name: string): number | undefined {
  const match = /(?:^|\D)(20\d{2})(\d{2})(\d{2})[_ -]?(\d{2})(\d{2})(\d{2})(?:\D|$)/.exec(name);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(year!, month! - 1, day, hour, minute, second);
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second ? date.getTime() : undefined;
}

export function orderPhotos(photos: readonly ImportPhoto[], order: PhotoOrder): ImportPhoto[] {
  return [...photos].sort((a, b) => {
    if (order === 'time') {
      if (a.timestamp !== undefined && b.timestamp === undefined) return -1;
      if (a.timestamp === undefined && b.timestamp !== undefined) return 1;
      if (a.timestamp !== undefined && b.timestamp !== undefined && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    }
    return names.compare(a.fileName, b.fileName) || a.id - b.id;
  });
}

export function movePhoto(photos: readonly ImportPhoto[], index: number, delta: -1 | 1): ImportPhoto[] {
  const destination = index + delta;
  if (index < 0 || index >= photos.length || destination < 0 || destination >= photos.length) return [...photos];
  const rows = [...photos];
  [rows[index], rows[destination]] = [rows[destination]!, rows[index]!];
  return rows;
}
