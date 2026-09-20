import { createContext } from 'react';

/** Hidden question pages retain drafts but are not active reading surfaces. */
export const QuestionPageActivity = createContext(true);
