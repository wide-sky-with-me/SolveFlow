import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { PhotoDisplayCache } from './photo-display-cache-core';

export { PHOTO_DISPLAY_CACHE_BYTES, PHOTO_DISPLAY_CACHE_ENTRIES, PhotoDisplayCache } from './photo-display-cache-core';

const sharedWebPhotoCache = new PhotoDisplayCache();

export function warmPhotoDisplayUri(uri: string | null | undefined) {
  if (Platform.OS !== 'web') return;
  sharedWebPhotoCache.warm(uri);
}

export function usePhotoDisplayUri(uri: string): string {
  const [resolved, setResolved] = useState<{ source: string; url: string }>(() => {
    if (Platform.OS !== 'web' || !uri.startsWith('data:image/')) return { source: uri, url: uri };
    return { source: uri, url: sharedWebPhotoCache.warm(uri) ?? uri };
  });
  useEffect(() => {
    if (Platform.OS !== 'web' || !uri.startsWith('data:image/')) {
      setResolved({ source: uri, url: uri });
      return;
    }
    const lease = sharedWebPhotoCache.acquire(uri);
    setResolved({ source: uri, url: lease.url });
    return () => lease.release();
  }, [uri]);
  return resolved.source === uri ? resolved.url : (Platform.OS === 'web' && uri.startsWith('data:image/') ? sharedWebPhotoCache.warm(uri) ?? uri : uri);
}
