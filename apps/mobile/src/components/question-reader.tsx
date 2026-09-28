import type { ComponentProps } from 'react';
import type { questionConversations } from '@solveflow/client';
import { QuestionPager } from './question-pager';
import { QuestionThread } from './question-thread';
/** One answer surface for current questions and photos within a batch. */
export function QuestionReader({ threads, selected, onSelect, ...props }: Omit<ComponentProps<typeof QuestionThread>, 'thread' | 'onPageSwipe'> & { threads: ReturnType<typeof questionConversations>; selected: string; onSelect: (key: string) => void }) {
  return <QuestionPager threads={threads} selected={selected} onSelect={onSelect} render={(thread, onPageSwipe) => <QuestionThread {...props} thread={thread} onPageSwipe={onPageSwipe} />} />;
}
