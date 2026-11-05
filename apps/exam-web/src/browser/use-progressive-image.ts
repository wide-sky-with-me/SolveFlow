import { useEffect, useState } from 'react';
import { imagePaths, type CachedImage, type ImageLease } from './image-cache.js';
import { useImageCache } from './image-session.js';
type ImageState = {
    image: CachedImage | null;
    error: string;
    loading: boolean;
};
const empty: ImageState = { image: null, error: '', loading: false };
export function useProgressiveImage(src: string, local = false) {
    if (local && !src.startsWith('blob:')) throw new Error('本地图片地址无效。');
    const cache = useImageCache(), paths = local ? { source: src, preview: src } : imagePaths(src);
    const [previewEnabled, setPreviewEnabled] = useState(() => !local && !cache.has(paths.source)), [wanted, setWanted] = useState(() => local || cache.has(paths.source));
    const [previewAttempt, setPreviewAttempt] = useState(0), [sourceAttempt, setSourceAttempt] = useState(0), [preview, setPreview] = useState<ImageState>(empty), [source, setSource] = useState<ImageState>(empty);
    useEffect(() => {
        if (local || !previewEnabled)
            return;
        let alive = true, lease: ImageLease | undefined;
        setPreview({ ...empty, loading: true });
        try {
            lease = cache.acquire(paths.preview);
            void lease.promise.then(image => { if (alive)
                setPreview({ image, error: '', loading: false }); }, error => { if (alive) {
                setPreview({ ...empty, error: error instanceof Error ? error.message : '预览加载失败。' });
                setWanted(true);
            } });
        }
        catch (error) {
            setPreview({ ...empty, error: error instanceof Error ? error.message : '预览加载失败。' });
            setWanted(true);
        }
        return () => { alive = false; lease?.release(); };
    }, [cache, paths.preview, previewEnabled, previewAttempt, local]);
    useEffect(() => {
        if (local) { setSource({ image: { url: src, bytes: 0 }, error: '', loading: false }); return; }
        if (!wanted) {
            setSource(empty);
            return;
        }
        let alive = true, lease: ImageLease | undefined;
        setSource({ ...empty, loading: true });
        try {
            lease = cache.acquire(paths.source);
            void lease.promise.then(image => { if (alive)
                setSource({ image, error: '', loading: false }); }, error => { if (alive)
                setSource({ ...empty, error: error instanceof Error ? error.message : '原图加载失败。' }); });
        }
        catch (error) {
            setSource({ ...empty, error: error instanceof Error ? error.message : '原图加载失败。' });
        }
        return () => { alive = false; lease?.release(); };
    }, [cache, paths.source, wanted, sourceAttempt, local, src]);
    return { preview, source, wanted, requestSource: () => setWanted(true), retrySource: () => { cache.forget(paths.source); setWanted(true); setSourceAttempt(value => value + 1); }, retry: () => { if (local) { setSourceAttempt(value => value + 1); return; } setPreviewEnabled(true); setWanted(false); setPreviewAttempt(value => value + 1); }, decodeFailed: (original: boolean) => { cache.forget(original ? paths.source : paths.preview); const value = { ...empty, error: original ? '原图加载失败，请重试。' : '预览加载失败。' }; if (original)
            setSource(value);
        else {
            setPreview(value);
            setWanted(true);
        } } };
}
