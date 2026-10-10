import { z } from 'zod';
import { MAX_USER_MESSAGE_CHARACTERS, type SolverInput } from '@solveflow/contracts/agent';
import { MAX_QUESTION_IMAGE_BYTES, type LocalRecord } from '@solveflow/contracts/local';
import {
  MAX_AUXILIARY_RUNS,
  MAX_CONVERSATION_RUNS,
  RunContextSchema,
  isAuxiliaryContext,
  projectQuestionRun,
  questionThreadHistory,
  terminal,
  type RunContext,
  type RunView,
} from '@solveflow/contracts/http';
import { conversationHistory, resolveLearningContext } from './learning-history.js';
import { currentImageIds } from './local-image-selection.js';

type PreparedRequest = Pick<
  SolverInput,
  'focus' | 'problemCorrection' | 'history' | 'image' | 'materials' | 'verificationTarget' | 'answerMode' | 'useBackup'
>;

/** A request is scoped to an answer version and, for grouped photos, a question. */
function matchesRequestContext(saved: RunContext | undefined, requested: RunContext) {
  if (!saved || saved.kind !== requested.kind || saved.sourceRunId !== requested.sourceRunId) return false;
  const savedNumber = 'number' in saved ? saved.number : undefined;
  const requestedNumber = 'number' in requested ? requested.number : undefined;
  return savedNumber === requestedNumber;
}

function assertWithinRunLimits(runs: readonly RunView[], auxiliary: boolean) {
  const auxiliaryCount = runs.filter(run => isAuxiliaryContext(run.context?.kind)).length;
  if (auxiliary && auxiliaryCount >= MAX_AUXILIARY_RUNS) {
    throw new Error('本题的步骤、知识点和校验请求已达到30次上限。');
  }
  if (!auxiliary && runs.length - auxiliaryCount >= MAX_CONVERSATION_RUNS) {
    throw new Error('本题已完成10轮对话，请新建题目继续。');
  }
}

function assertNoPendingDuplicate(runs: readonly RunView[], context: RunContext | undefined) {
  const pending = runs.filter(run => !terminal(run.status));
  if (isAuxiliaryContext(context?.kind)) {
    const duplicate = context && pending.some(run => matchesRequestContext(run.context, context));
    if (duplicate) throw new Error('该按需请求正在进行中。');
  } else if (pending.length) {
    throw new Error('本题已有进行中的任务。');
  }
}

// Decision: .agents/notes/implemented/architecture/2026-10-03-local-request-preparation.md
/**
 * Read-only preparation; LocalEngine calls this inside its admission lock.
 * Reject invalid/cached requests and decode the photo BEFORE saving queued or
 * occupying a slot. This module does not write storage or invoke a model.
 */
export function prepareLocalRunRequest(
  record: LocalRecord,
  message: string,
  context: RunContext | undefined,
): PreparedRequest & { imageIds: string[] } {
  z.string().max(MAX_USER_MESSAGE_CHARACTERS).parse(message);
  if (context) RunContextSchema.parse(context);

  const runs = record.session.runs;
  // A batch correction can replace this candidate until its source run is terminal.
  // Learning content must stay bound to a stable saved answer version.
  if (context?.kind === 'explanation' || context?.kind === 'knowledge-list') {
    const source = runs.find(run => run.id === context.sourceRunId);
    if (source && !terminal(source.status)) throw new Error('请等待本题校验或修正完成，再生成学习内容。');
  }
  assertWithinRunLimits(runs, isAuxiliaryContext(context?.kind));
  assertNoPendingDuplicate(runs, context);

  const hasCompletedRequest = context && runs.some(run =>
    matchesRequestContext(run.context, context) && run.outcome?.status === 'completed',
  );
  if (context?.kind === 'explanation' && hasCompletedRequest) {
    throw new Error('EXPLANATION_ALREADY_SAVED');
  }
  if (context?.kind === 'knowledge-list' && hasCompletedRequest) {
    throw new Error('KNOWLEDGE_ALREADY_SAVED');
  }

  // Verification reads the selected saved candidate, never a caller-supplied answer.
  const source = context?.kind === 'verification'
    ? runs.find(run => run.id === context.sourceRunId)
    : undefined;
  const target = source
    ? projectQuestionRun(source, context?.kind === 'verification' ? context.number : undefined).outcome
    : undefined;
  if (context?.kind === 'verification') {
    if (target?.status !== 'completed') throw new Error('INVALID_SAVED_CONTEXT');
    const hasVerification = runs.some(run =>
      matchesRequestContext(run.context, context)
      && (run.outcome?.status === 'completed' || run.outcome?.status === 'needs_clarification'),
    );
    if (hasVerification) throw new Error('VERIFICATION_ALREADY_SAVED');
  }

  const learning = resolveLearningContext(runs, context ?? null);
  const selectedHistory = context ? questionThreadHistory(runs, context) : runs;
  const history = conversationHistory(selectedHistory, learning.focus ? 4096 : 12288);
  const detailed = context && ['explanation', 'step', 'knowledge', 'knowledge-list'].includes(context.kind);
  // Decision: .agents/notes/implemented/agent/2026-10-04-exam-response-and-materials.md
  // Auxiliary checks use the original run's image snapshot, never later additions.
  const sourceRun = context && isAuxiliaryContext(context.kind) ? runs.find(run => run.id === context.sourceRunId) : undefined;
  const imageIds = context && isAuxiliaryContext(context.kind)
    ? sourceRun?.imageIds ?? [record.session.upload.id, ...(sourceRun?.materialIds ?? [])]
    : currentImageIds(record);
  const images = imageIds.map(id => {
    const image = id === record.session.upload.id ? record.image : record.materials?.find(item => item.id === id)?.image;
    if (!image) throw new Error('解答引用的材料缺失，请从备份恢复。');
    const binary = atob(image.slice(image.indexOf(',') + 1));
    return { id, image: { bytes: Uint8Array.from(binary, character => character.charCodeAt(0)), mimeType: 'image/jpeg' as const } };
  });
  const primary = images[0];
  if (!primary) throw new Error('请至少保留一张题目图片。');
  const bytes = primary.image.bytes;
  const materials = images.slice(1);

  if (bytes.byteLength + materials.reduce((sum, item) => sum + item.image.bytes.byteLength, 0) > MAX_QUESTION_IMAGE_BYTES) throw new Error('同题图片总大小超过8MiB。');
  return {
    imageIds,
    ...learning,
    ...(context?.kind === 'regenerate' && context.useBackup ? { useBackup: true as const } : {}),
    history,
    image: { bytes, mimeType: 'image/jpeg' },
    ...(materials.length ? { materials } : {}),
    ...(target?.status === 'completed' ? { verificationTarget: target.candidate } : {}),
    answerMode: detailed ? 'detailed' : 'brief',
  };
}
