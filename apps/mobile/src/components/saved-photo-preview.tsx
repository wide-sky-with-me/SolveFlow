import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LocalRepository } from '@solveflow/client/local';
import { MAX_BATCH_PHOTOS } from '@solveflow/contracts/local';
import { PhotoThumbnailCache } from '../photo-thumbnail-cache';
import { releasePhoto, transformPhoto } from '../platform';
import type { Photo } from '../platform.types';
import { Image, Text } from '../theme/primitives';
import { s } from './ui';

const Previews = createContext<PhotoThumbnailCache<string> | null>(null);
// Decision: .agents/notes/implemented/architecture/2026-10-29-shared-image-workbenches.md
export function SavedPhotoPreviewProvider({ repository, ids, children }: { repository: LocalRepository; ids: readonly string[]; children: ReactNode }) {
  const cache = useMemo(() => new PhotoThumbnailCache<string>(async id => {
    const source = await repository.readPrimaryImage(id);
    return transformPhoto({ uri: source.image, width: source.width, height: source.height }, undefined, false, 160);
  }, releasePhoto, MAX_BATCH_PHOTOS), [repository]);
  useEffect(() => () => cache.clear(), [cache]);
  useEffect(() => { cache.retain(new Set(ids)); }, [cache, ids]);
  return <Previews.Provider value={cache}>{children}</Previews.Provider>;
}
export function SavedPhotoPreview({ id }: { id: string }) {
  const cache = useContext(Previews); const [preview, setPreview] = useState<{ id: string; value: Photo | null }>();
  useEffect(() => { let alive = true; const lease = cache?.acquire(id); void lease?.ready.then(value => { if (alive) setPreview({ id, value }); }); return () => { alive = false; lease?.release(); }; }, [cache, id]);
  const current = preview?.id === id ? preview : undefined;
  return current?.value ? <Image source={{ uri: current.value.uri }} accessibilityLabel="批次题图缩略图" resizeMode="contain" style={{ width: '100%', height: '100%' }} /> : <Text style={s.subtitle}>{current ? '预览不可用' : '…'}</Text>;
}
