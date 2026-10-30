import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Photo } from '../platform.types';
import { releasePhoto, transformPhoto } from '../platform';
import { PhotoThumbnailCache } from '../photo-thumbnail-cache';
import { Image, Text } from '../theme/primitives';
import { s } from './ui';

const Previews = createContext<PhotoThumbnailCache | null>(null);
export function ImportPhotoPreviewProvider({ children, photos }: { children: ReactNode; photos: readonly Photo[] }) {
  const cache = useMemo(() => new PhotoThumbnailCache(photo => transformPhoto(photo, undefined, false, 192), releasePhoto), []);
  useEffect(() => () => cache.clear(), [cache]);
  useEffect(() => { cache.retain(new Set(photos)); }, [cache, photos]);
  return <Previews.Provider value={cache}>{children}</Previews.Provider>;
}
export function ImportPhotoPreview({ photo, label }: { photo: Photo; label: string }) {
  const cache = useContext(Previews);
  const [preview, setPreview] = useState<{ source: Photo; value: Photo | null }>();
  useEffect(() => {
    let alive = true; const lease = cache?.acquire(photo);
    void lease?.ready.then(value => { if (alive) setPreview({ source: photo, value }); });
    return () => { alive = false; lease?.release(); };
  }, [cache, photo]);
  const value = preview?.source === photo ? preview : undefined;
  return value?.value ? <Image source={{ uri: value.value.uri }} resizeMode="contain" accessibilityLabel={label} style={{ width: '100%', height: '100%' }} /> : <Text accessibilityLabel={value ? '缩略图暂不可用，可编辑查看原图' : '正在生成缩略图'} style={[s.subtitle, { margin: 'auto', fontSize: 12 }]}>{value ? '预览不可用' : '…'}</Text>;
}
