import type { ReactNode } from 'react';

type IconName = 'camera' | 'album' | 'history' | 'book' | 'chevron-down' | 'chevron-right' | 'check' | 'logout' | 'trash' | 'arrow-right' | 'key';

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    camera: <><path d="M8 6.5 9.5 4h5L16 6.5h3a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3.5"/></>,
    album: <><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/></>,
    history: <><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
    book: <><path d="M12 5.5C9.7 3.7 6.2 3.5 3 4.5V19c3.2-1 6.7-.8 9 1 2.3-1.8 5.8-2 9-1V4.5c-3.2-1-6.7-.8-9 1ZM12 5.5V20"/></>,
    'chevron-down': <path d="m7 10 5 5 5-5"/>,
    'chevron-right': <path d="m9 6 6 6-6 6"/>,
    check: <path d="m5 12 4.5 4.5L19 7"/>,
    logout: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M9 12h10"/></>,
    trash: <><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></>,
    'arrow-right': <path d="M4 12h15m-6-6 6 6-6 6"/>,
    key: <><circle cx="8" cy="9" r="4"/><path d="m11 12 9 9M15 16l3-3M18 19l3-3"/></>,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

/** Same paper-and-camera composition as the full application's native empty state. */
export function CaptureArtwork({ history = false }: { history?: boolean }) {
  return <div className={`capture-art ${history ? 'history-art' : ''}`} aria-hidden="true">
    <span className="art-orbit"/><span className="art-dot art-dot-one"/><span className="art-dot art-dot-two"/>
    <span className="art-page-back"/>
    <span className="art-page"><i/><i/><i/><i/></span>
    <span className="art-badge"><Icon name={history ? 'history' : 'camera'}/></span>
  </div>;
}
