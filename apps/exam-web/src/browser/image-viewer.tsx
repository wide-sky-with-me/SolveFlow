import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { Dialog, ErrorText } from './components.js';
import { Icon } from '@solveflow/web-ui/icons';
import { useProgressiveImage } from './use-progressive-image.js';
import './image-viewer.css';

type Point = { x: number; y: number };
export function ImageViewer({ src, onClose, local = false }: { src: string; onClose: () => void; local?: boolean }) {
    const viewport = useRef<HTMLDivElement>(null), pointers = useRef(new Map<number, Point>());
    const previewImage = useRef<HTMLImageElement>(null), sourceImage = useRef<HTMLImageElement>(null);
    const { preview, source, wanted, requestSource, retrySource, retry, decodeFailed } = useProgressiveImage(src, local);
    const [decodedPreview, setDecodedPreview] = useState(''), [decodedSource, setDecodedSource] = useState('');
    const pinch = useRef<{ span: number; scale: number } | null>(null), desiredScroll = useRef<Point | null>(null);
    const [natural, setNatural] = useState<Point | null>(null), [size, setSize] = useState({ x: 0, y: 0 }), [scale, setScale] = useState(1);
    const originalReady = !!source.image && decodedSource === source.image.url;
    const previewReady = !!preview.image && decodedPreview === preview.image.url;
    const ready = originalReady || previewReady;
    const [expanded, setExpanded] = useState(false);
    const current = useRef({ scale, size, fit: { x: 0, y: 0 } });
    const ratio = natural ? Math.min((size.x-24)/natural.x, (size.y-24)/natural.y) : 0;
    const fit = natural && ratio > 0 ? { x: natural.x*ratio, y: natural.y*ratio } : { x: 0, y: 0 };
    current.current = { scale, size, fit };
    function loaded(element: HTMLImageElement, original: boolean) {
        // Keep the same geometry and scroll position when the original replaces the preview.
        setNatural(value => value ?? { x: element.naturalWidth, y: element.naturalHeight });
        if(original) setDecodedSource(element.src); else setDecodedPreview(element.src);
    }
    useLayoutEffect(() => {
        if(previewImage.current?.complete && previewImage.current.naturalWidth > 0) loaded(previewImage.current, false);
        if(sourceImage.current?.complete && sourceImage.current.naturalWidth > 0) loaded(sourceImage.current, true);
    }, [preview.image?.url, source.image?.url]);
    useEffect(() => {
        const element=previewImage.current;
        if(!wanted && previewReady && (scale>=1.2 || (element && (fit.x*scale>element.naturalWidth || fit.y*scale>element.naturalHeight)))) requestSource();
    }, [wanted, previewReady, scale, fit.x, fit.y, requestSource]);
    useEffect(() => {
        const element = viewport.current; if (!element) return;
        const measure = () => { setSize({ x: element.clientWidth, y: element.clientHeight }); setScale(1); desiredScroll.current = { x: 0, y: 0 }; pointers.current.clear(); pinch.current = null; };
        const observer = new ResizeObserver(measure); observer.observe(element, { box: 'border-box' }); measure();
        const wheel = (event: WheelEvent) => { event.preventDefault(); const box = element.getBoundingClientRect(); zoom(current.current.scale*Math.exp(-event.deltaY*.002), { x: event.clientX-box.left, y: event.clientY-box.top }); };
        element.addEventListener('wheel', wheel, { passive: false });
        return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); pointers.current.clear(); };
    }, []);
    useLayoutEffect(() => { const point = desiredScroll.current; if (point && viewport.current) { viewport.current.scrollLeft=point.x; viewport.current.scrollTop=point.y; desiredScroll.current=null; } }, [scale, size]);
    function zoom(value: number, anchor?: Point) {
        const element = viewport.current, before = current.current; if (!element || !before.fit.x) return;
        const next = Math.max(1, Math.min(4, value)); if (next === before.scale) return;
        const point = anchor ?? { x: before.size.x/2, y: before.size.y/2 };
        const axis = (dimension: 'x' | 'y', scroll: number) => {
            const oldMargin = Math.max(0, (before.size[dimension]-before.fit[dimension]*before.scale)/2), newMargin = Math.max(0, (before.size[dimension]-before.fit[dimension]*next)/2);
            return (scroll+point[dimension]-oldMargin)/before.scale*next+newMargin-point[dimension];
        };
        desiredScroll.current = { x: axis('x',element.scrollLeft), y: axis('y',element.scrollTop) };
        current.current = { ...before, scale: next }; setScale(next);
    }
    function down(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || pointers.current.size >= 2) return;
        event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const [a,b] = [...pointers.current.values()]; if (a && b) pinch.current = { span: Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)), scale: current.current.scale };
    }
    function move(event: PointerEvent<HTMLDivElement>) {
        const previous = pointers.current.get(event.pointerId); if (!previous) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const [a,b] = [...pointers.current.values()];
        if (a && b && pinch.current) { const box = event.currentTarget.getBoundingClientRect(); zoom(pinch.current.scale*Math.hypot(b.x-a.x,b.y-a.y)/pinch.current.span, { x: (a.x+b.x)/2-box.left, y: (a.y+b.y)/2-box.top }); }
        else { event.currentTarget.scrollLeft += previous.x-event.clientX; event.currentTarget.scrollTop += previous.y-event.clientY; }
    }
    function up(event: PointerEvent<HTMLDivElement>) { pointers.current.delete(event.pointerId); pinch.current=null; }
    return <div className="image-viewer-layer" onKeyDownCapture={event=>{if(expanded&&event.key==='Escape'){event.preventDefault();event.stopPropagation();setExpanded(false);}}}><Dialog title="题图" size="wide" className={'image-viewer'+(expanded?' image-viewer-expanded':'')} onClose={onClose}>
      <div className="image-viewer-tools"><button className="secondary" aria-label="缩小图片" disabled={!ready || scale<=1} onClick={()=>zoom(scale/1.25)}>−</button><output aria-label="图片缩放比例">{Math.round(scale*100)}%</output><button className="secondary" aria-label="放大图片" disabled={!ready || scale>=4} onClick={()=>zoom(scale*1.25)}>＋</button><button className="quiet image-fit-button" disabled={!ready} onClick={()=>zoom(1)}>适应窗口</button><button className="quiet image-source-button" aria-label="高清原图" aria-pressed={originalReady} disabled={source.loading||originalReady} onClick={source.error?retrySource:requestSource}>高清原图</button><button className="quiet image-fullscreen-button" aria-label={expanded?'退出全屏查看':'全屏查看'} aria-pressed={expanded} title={expanded?'退出全屏查看':'全屏查看'} onClick={()=>setExpanded(value=>!value)}><Icon name="expand"/><span>{expanded?'退出全屏':'全屏查看'}</span></button></div>
      {!ready && source.error && <div className="image-load-error"><ErrorText error={source.error}/><button onClick={retry}>重试加载</button></div>}
      {!ready && !source.error && <div className="image-load-pending" role="status">正在加载图片…</div>}
      {ready && source.loading && <div className="image-upgrade-status" role="status">正在加载高清原图…</div>}
      {ready && source.error && <div className="image-upgrade-status image-upgrade-error" role="alert"><span>高清原图加载失败</span><button className="quiet" onClick={retrySource}>重试原图</button></div>}
      <div ref={viewport} className="image-viewer-viewport" tabIndex={0} aria-label="题目原图查看区域" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onDoubleClick={event=>{const box=event.currentTarget.getBoundingClientRect();zoom(scale>1?1:2,{x:event.clientX-box.left,y:event.clientY-box.top});}}>
        <div className="image-viewer-stage" style={{width:Math.max(size.x,fit.x*scale),height:Math.max(size.y,fit.y*scale)}}><div className="image-viewer-frame" style={{width:fit.x*scale||1,height:fit.y*scale||1}}>
          {preview.image && <img ref={previewImage} src={preview.image.url} alt="题目清晰预览" aria-hidden={!previewReady||originalReady} data-display-image={previewReady&&!originalReady} draggable={false} style={{visibility:previewReady&&!originalReady?'visible':'hidden'}} onLoad={event=>loaded(event.currentTarget,false)} onError={()=>decodeFailed(false)}/>}
          {source.image && <img ref={sourceImage} src={source.image.url} alt="题目原图" aria-hidden={!originalReady} data-display-image={originalReady} draggable={false} style={{visibility:originalReady?'visible':'hidden'}} onLoad={event=>loaded(event.currentTarget,true)} onError={()=>decodeFailed(true)}/>}
        </div></div>
      </div>
    </Dialog></div>;
}
