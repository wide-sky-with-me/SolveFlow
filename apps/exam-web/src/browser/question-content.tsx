import { useEffect, useState } from 'react';
import type { ProblemStatement } from '@solveflow/contracts/agent';
import type { ExamSlot } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { mediaPath, type ImageLease } from './image-cache.js';
import { useImageCache } from './image-session.js';
import { RichText } from './rich-text.js';

function QuestionThumbnail({ image, onOpen }: { image: ExamSlot['images'][number]; onOpen: (src: string) => void }) {
    const cache = useImageCache();
    const [url, setUrl] = useState('');
    useEffect(() => {
        let alive = true, lease: ImageLease | undefined;
        setUrl('');
        try {
            lease = cache.acquire(mediaPath(image.id, 'thumbnail'));
            void lease.promise.then(cached => { if (alive) setUrl(cached.url); }, () => { if (alive) setUrl(''); });
        } catch {
            setUrl('');
        }
        return () => { alive = false; lease?.release(); };
    }, [cache, image.id]);
    const warmPreview = () => cache.prefetch(mediaPath(image.id, 'model'), true);
    return <button className="thumbnail" onPointerEnter={warmPreview} onFocus={warmPreview} onClick={() => onOpen(mediaPath(image.id, 'source'))} aria-label={image.role === 'primary' ? '查看原图' : '查看补图'}>
      {url && <img src={url} alt={image.role === 'primary' ? '题目原图' : '补图'} decoding="async"/>}<span className="image-open-mark"><Icon name="expand"/></span>
    </button>;
}

export function QuestionImages({ images, onOpen }: { images: ExamSlot['images']; onOpen: (src: string) => void }) {
    const cache = useImageCache();
    const ids = images.map(image => `${image.role}:${image.id}`).join(',');
    useEffect(() => {
        if (!images.length) return;
        const ordered = [...images].sort((a, b) => (a.role === 'primary' ? -1 : 1) - (b.role === 'primary' ? -1 : 1));
        for (let index = ordered.length - 1; index >= 0; index--) {
            const item = ordered[index];
            if (item) cache.prefetch(mediaPath(item.id, 'model'), true);
        }
    }, [cache, ids]);
    if (!images.length) return null;
    return <div className="thumbnails question-images">{images.map(image => <QuestionThumbnail key={image.id} image={image} onOpen={onOpen}/>)}</div>;
}

export function QuestionContent({ problem, selectedOptions = [], hideOptions = false }: { problem: ProblemStatement; selectedOptions?: string[]; hideOptions?: boolean }) {
    return <section className="question-content" aria-label="识别题目"><h3>识别题目</h3><RichText text={problem.text}/>{!hideOptions && problem.options?.map(option => <div className={'option'+(selectedOptions.includes(option.label)?' selected':'')} key={option.label}><b>{option.label}</b><RichText text={option.text}/></div>)}</section>;
}
