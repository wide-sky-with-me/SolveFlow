import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { SessionImageCache } from './image-cache.js';
const ImageCacheContext = createContext<SessionImageCache | null>(null);
export function ImageSession({ children }: {
    children: ReactNode;
}) {
    const [cache] = useState(() => new SessionImageCache());
    useEffect(() => () => cache.dispose(), [cache]);
    return <ImageCacheContext.Provider value={cache}>{children}</ImageCacheContext.Provider>;
}
export function useImageCache() {
    const shared = useContext(ImageCacheContext), [local] = useState(() => new SessionImageCache());
    useEffect(() => () => local.dispose(), [local]);
    return shared ?? local;
}
