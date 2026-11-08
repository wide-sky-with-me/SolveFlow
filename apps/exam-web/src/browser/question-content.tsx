import type { ProblemStatement } from '@solveflow/contracts/agent';
import type { ExamSlot } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { RichText } from './rich-text.js';

export function QuestionImages({ images, onOpen }: { images: ExamSlot['images']; onOpen: (src: string) => void }) {
    if (!images.length) return null;
    return <div className="thumbnails question-images">{images.map(image => <button key={image.id} className="thumbnail" onClick={() => onOpen('/api/v2/media/' + image.id + '?view=source')} aria-label={image.role === 'primary' ? '查看原图' : '查看补图'}>
      <img src={'/api/v2/media/' + image.id + '?view=thumbnail'} alt={image.role === 'primary' ? '题目原图' : '补图'} loading="lazy"/><span className="image-open-mark"><Icon name="expand"/></span>
    </button>)}</div>;
}

export function QuestionContent({ problem, selectedOptions = [], hideOptions = false }: { problem: ProblemStatement; selectedOptions?: string[]; hideOptions?: boolean }) {
    return <section className="question-content" aria-label="识别题目"><h3>识别题目</h3><RichText text={problem.text}/>{!hideOptions && problem.options?.map(option => <div className={'option'+(selectedOptions.includes(option.label)?' selected':'')} key={option.label}><b>{option.label}</b><RichText text={option.text}/></div>)}</section>;
}
