// Compatibility entry. New consumers select local, remote, learning or presentation.
// Decision: .agents/notes/implemented/architecture/2026-10-05-source-and-build-boundaries.md
export * from "./client.js";
export * from "./sse.js";
export * from "./submission.js";
export * from "./question-conversations.js";
export * from "./math-delimiters.js";
export * from "./image-crop.js";
export * from "./watch-run.js";

export * from "./learning-history.js";
export * from './local-repository.js';
export * from './local-engine.js';
export * from './local-history-export.js';
export * from './answer-payload.js';
export * from './history-payload.js';
export * from './tex-edit.js';

export * from "./local-batch.js";
export { verificationFeedback } from './verification-feedback.js';

export * from './local-history-import.js';
