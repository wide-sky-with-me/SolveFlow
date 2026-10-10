import { useCallback, useEffect, useRef, useState } from 'react';
import { shareImage } from '../share-image';

export function useImageShare(uri: string | null) {
  const [error, setError] = useState('');
  const busy = useRef(false); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const share = useCallback(async () => {
    if (!uri || busy.current) return;
    busy.current = true; setError('');
    try { await shareImage(uri); }
    catch { if (alive.current) setError('图片分享未能打开，请重试或使用支持系统图片分享的手机 App。'); }
    finally { busy.current = false; }
  }, [uri]);
  return { share, error };
}
