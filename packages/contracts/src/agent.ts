import { z } from "zod";
import { ExamTypeSchema } from './exam.js';
import { ProblemStatementSchema, KnowledgeDetailsSchema } from "./learning-content.js";
export { ProblemStatementSchema, KnowledgeDetailsSchema, originalIllustrationBounds, type ProblemStatement, type KnowledgeDetail } from "./learning-content.js";
import { FiguresSchema } from "./figure.js";

/** Shared per-run caps; initial solve, revision and format repair share Solver attempts. */
export const MAX_SOLVER_MODEL_ATTEMPTS = 16;
export const MAX_VERIFIER_MODEL_ATTEMPTS = 2;
export const MAX_MODEL_DISPATCHES = MAX_SOLVER_MODEL_ATTEMPTS + MAX_VERIFIER_MODEL_ATTEMPTS;

const text = (max: number) => z.string().trim().min(1).max(max);
export const IdentifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
export const SubjectSchema = text(40);
export const RunIdentitySchema = z.strictObject({ ownerId: IdentifierSchema, sessionId: IdentifierSchema, runId: IdentifierSchema });
export type RunIdentity = z.infer<typeof RunIdentitySchema>;

/** Server-only adapter data. Parsing does not authenticate the owner or decode/
 * normalize an image: upload validation/EXIF removal must already have happened. */
export const NormalizedImageSchema = z.strictObject({
  bytes: z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= 4 * 1024 * 1024, "图片字节超限").transform(value => Uint8Array.from(value)),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
export type NormalizedImage = z.infer<typeof NormalizedImageSchema>;

const uniqueIds = z.array(IdentifierSchema).max(16).refine(values => new Set(values).size === values.length, "标识符不能重复");
export const TeachingStepSchema = z.strictObject({ id: IdentifierSchema, title: text(120), explanation: text(2000), latex: text(2000).optional() });
const steps = z.array(TeachingStepSchema).max(16).refine(values => new Set(values.map(step => step.id)).size === values.length, "步骤标识符不能重复");
const problem = ProblemStatementSchema;
const candidateFields = { schemaVersion: z.literal(1), problem, knowledgePoints: z.array(text(120)).max(16), citationIds: uniqueIds };
const selectedOptions = z.array(text(1).regex(/^[A-Z]$/)).min(1).max(10).refine(values => new Set(values).size === values.length, "所选标签不能重复");
function checkSelection(value: { problem?: z.infer<typeof ProblemStatementSchema> | undefined; selectedOptions?: string[] | undefined }, ctx: z.RefinementCtx): void {
  const options = value.problem?.options;
  if (options && !value.selectedOptions || value.selectedOptions && (!options || value.selectedOptions.some(label => !options.some(option => option.label === label)))) {
    ctx.addIssue({ code: "custom", message: "选择题必须提供所选标签，且每个标签须属于原题选项", path: ["selectedOptions"] });
  }
}
const QuestionGroupSchema = z.strictObject({
  number: z.number().int().min(1).max(999), answer: text(1000), selectedOptions: selectedOptions.optional(),
  problem: ProblemStatementSchema.optional(), knowledgeDetails: KnowledgeDetailsSchema.optional(),
  stepIds: z.array(IdentifierSchema).max(16), figureIds: z.array(IdentifierSchema).max(3),
}).superRefine(checkSelection);

/** Solver can reference evidence IDs, never invent URLs or set verification. */
export const AnswerCandidateSchema = z.strictObject({
  ...candidateFields, kind: z.literal("answer"), answer: text(4000), selectedOptions: selectedOptions.optional(), steps, clarificationQuestions: z.array(text(500)).max(0),
  figures: FiguresSchema.optional(), knowledgeDetails: KnowledgeDetailsSchema.optional(),
  questions: z.array(QuestionGroupSchema).min(2).max(4).optional(),
}).superRefine((value, ctx) => {
  if (!value.questions) { checkSelection(value, ctx); return; }
  if (value.selectedOptions || value.problem.options) ctx.addIssue({ code: "custom", message: "多题只在各题内提供选项与所选标签", path: ["selectedOptions"] });
  if (new Set(value.questions.map(question => question.number)).size !== value.questions.length) {
    ctx.addIssue({ code: "custom", message: "题号不能重复", path: ["questions"] });
  }
  // Partition the existing global IDs, so verifier/revision references remain stable.
  for (const [field, expected] of [
    ["stepIds", value.steps.map(step => step.id)],
    ["figureIds", (value.figures ?? []).map(figure => figure.id)],
  ] as const) {
    const assigned = value.questions.flatMap(question => question[field]);
    if (assigned.length !== expected.length || new Set(assigned).size !== assigned.length || assigned.some(id => !expected.includes(id))) {
      ctx.addIssue({ code: "custom", message: "每个步骤和图示必须且只能归属一道题", path: ["questions", field] });
    }
  }
});
export const ClarificationCandidateSchema = z.strictObject({
  ...candidateFields, kind: z.literal("clarification"), answer: z.null(), steps: z.array(TeachingStepSchema).max(0), clarificationQuestions: z.array(text(500)).min(1).max(5),
  refusalReason: z.enum(["policy", "emergency"]).optional(),
});
/** Fixed public response: never echo a rejected candidate, prompt, or harmful request. */
export function policyRefusal(reason: "policy" | "emergency" = "policy") {
  return ClarificationCandidateSchema.parse({ schemaVersion: 1, kind: "clarification", refusalReason: reason,
    problem: { text: "本次请求不在可解答范围内", subject: "general", uncertainties: [] }, answer: null, steps: [],
    knowledgePoints: [], citationIds: [], clarificationQuestions: [reason === "emergency" ? "你的安全很重要。如果你或他人正在面临危险，请立即联系当地急救或身边可信任的成年人，尽量远离危险物品并寻求陪伴。" : "我可以帮助解答学习题目，包括中立的政治、历史和安全教育课程题，但不能提供政治动员、立场宣传或危险操作指导。请提供一道合适的学习题，或继续询问解题方法。"] });
}
/** New generation requires learning metadata; stored v1 records remain readable without it. */
export const GeneratedAnswerCandidateSchema = AnswerCandidateSchema.safeExtend({
  knowledgeDetails: KnowledgeDetailsSchema.optional(),
  questions: z.array(QuestionGroupSchema.safeExtend({ problem: ProblemStatementSchema, knowledgeDetails: KnowledgeDetailsSchema.optional() })).min(2).max(4).optional(),
});
export const GeneratedSolverCandidateSchema = z.discriminatedUnion("kind", [GeneratedAnswerCandidateSchema, ClarificationCandidateSchema]);
export const SolverCandidateSchema = z.discriminatedUnion("kind", [AnswerCandidateSchema, ClarificationCandidateSchema]);
export type SolverCandidate = z.infer<typeof SolverCandidateSchema>;
export type AnswerCandidate = z.infer<typeof AnswerCandidateSchema>;

export const VerificationCheckSchema = z.enum(["transcription", "logic", "arithmetic", "units", "domain", "citations", "diagram"]);
export const VerificationIssueSchema = z.strictObject({
  code: z.enum(["TRANSCRIPTION", "LOGIC", "ARITHMETIC", "UNITS", "DOMAIN", "CITATIONS", "DIAGRAM", "INSUFFICIENT_EVIDENCE", "INVALID_CANDIDATE", "POLICY_VIOLATION", "OTHER"]),
  stepId: IdentifierSchema.optional(), message: text(500),
});
const issues = z.array(VerificationIssueSchema).max(16);
const checked = z.array(VerificationCheckSchema).max(7).refine(values => new Set(values).size === values.length, "核验项目不能重复");
export const VerificationSchema = z.strictObject({ schemaVersion: z.literal(1), verdict: z.enum(["pass", "fail", "unknown"]), issues, checked }).superRefine((value, ctx) => {
  if (value.verdict === "pass" && (value.issues.length > 0 || value.checked.length === 0)) ctx.addIssue({ code: "custom", message: "通过必须有核验项目且没有问题", path: ["verdict"] });
  if (value.verdict !== "pass" && value.issues.length === 0) ctx.addIssue({ code: "custom", message: "未通过或无法核验必须说明问题", path: ["issues"] });
});
export type Verification = z.infer<typeof VerificationSchema>;

const sourceUrl = z.url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}, "引用仅允许无凭据的HTTP链接");
export const ToolEvidenceSchema = z.strictObject({
  id: IdentifierSchema, kind: z.enum(["calculation", "reference", "search"]), summary: text(4000),
  source: z.strictObject({ title: text(300), url: sourceUrl, retrievedAt: z.iso.datetime() }).optional(),
});
export type ToolEvidence = z.infer<typeof ToolEvidenceSchema>;
const evidence = z.array(ToolEvidenceSchema).max(16).refine(values => new Set(values.map(item => item.id)).size === values.length, "证据标识符不能重复");

export const BriefSolverCandidateSchema = z.discriminatedUnion("kind", [AnswerCandidateSchema.safeExtend({
  answer: text(1000), steps: z.array(TeachingStepSchema).max(0), knowledgeDetails: KnowledgeDetailsSchema.max(0).optional(), knowledgePoints: z.array(text(120)).max(0),
  questions: z.array(QuestionGroupSchema.safeExtend({ problem: ProblemStatementSchema, stepIds: z.array(IdentifierSchema).max(0), knowledgeDetails: KnowledgeDetailsSchema.max(0).optional() })).min(2).max(4).optional(),
}), ClarificationCandidateSchema]);

const inputFields = {
  exam: ExamTypeSchema.optional(),
  verificationMode: z.enum(["automatic", "manual"]).optional(),
  answerMode: z.enum(["brief", "detailed"]).optional(),
  schemaVersion: z.literal(1), identity: RunIdentitySchema, message: z.string().trim().max(4000),
  image: NormalizedImageSchema, subject: SubjectSchema.optional(), evidence,
  // Server resolves the persisted reference; contents remain untrusted learning data.
  focus: z.strictObject({ sourceRunId: z.uuid(), kind: z.enum(["step", "question", "reply", "knowledge", "knowledge-list", "regenerate", "explanation"]), content: text(2000), verified: z.boolean() }).optional(),
  problemCorrection: text(2000).optional(),
  history: z.array(z.strictObject({ message: z.string().max(2000), answer: z.string().max(4000) })).max(9).optional(),
};
const revision = z.strictObject({ candidate: AnswerCandidateSchema, issues: issues.min(1) });
const SolverInputObject = z.strictObject({ ...inputFields, role: z.literal("solver"), verificationTarget: AnswerCandidateSchema.optional(), revision: revision.optional() });
const VerifierInputObject = z.strictObject({ ...inputFields, role: z.literal("verifier"), candidate: AnswerCandidateSchema });
function checkInputReferences(value: z.infer<typeof SolverInputObject> | z.infer<typeof VerifierInputObject>, ctx: z.RefinementCtx): void {
  const candidate = value.role === "verifier" ? value.candidate : value.revision?.candidate;
  if (!candidate) return;
  const ids = new Set(value.evidence.map(item => item.id));
  if (candidate.citationIds.some(id => !ids.has(id))) ctx.addIssue({ code: "custom", message: "候选引用缺少授权证据", path: ["evidence"] });
  if (value.role === "solver" && value.revision) {
    const stepIds = new Set(candidate.steps.map(step => step.id));
    if (value.revision.issues.some(issue => issue.stepId !== undefined && !stepIds.has(issue.stepId))) ctx.addIssue({ code: "custom", message: "修正问题指向未知步骤", path: ["revision", "issues"] });
  }
}
export const SolverInputSchema = SolverInputObject.superRefine(checkInputReferences);
export const VerifierInputSchema = VerifierInputObject.superRefine(checkInputReferences);
export const AgentInputSchema = z.discriminatedUnion("role", [SolverInputSchema, VerifierInputSchema]);
export type AgentInput = z.infer<typeof AgentInputSchema>;
export type SolverInput = Extract<AgentInput, { role: "solver" }>;
export type VerifierInput = Extract<AgentInput, { role: "verifier" }>;

/** Call with server-authorized evidence, not a model-produced evidence list.
 * Matching IDs only prove membership; upstream tool provenance is the caller’s job. */
export function parseCandidateWithEvidence(value: unknown, authorizedEvidence: readonly ToolEvidence[]): SolverCandidate {
  const approved = evidence.parse(authorizedEvidence);
  const candidate = SolverCandidateSchema.parse(value);
  const ids = new Set(approved.map(item => item.id));
  if (candidate.citationIds.some(id => !ids.has(id))) throw new Error("CANDIDATE_EVIDENCE_MISSING");
  return candidate;
}

export function parseVerificationForCandidate(value: unknown, candidateValue: unknown): Verification {
  const candidate = AnswerCandidateSchema.parse(candidateValue);
  const verification = VerificationSchema.parse(value);
  if ((candidate.figures?.length || candidate.problem.illustrations?.length || candidate.questions?.some(question => question.problem?.illustrations?.length)) && verification.verdict === "pass" && !verification.checked.includes("diagram")) throw new Error("DIAGRAM_NOT_VERIFIED");
  const ids = new Set(candidate.steps.map(step => step.id));
  if (verification.issues.some(issue => issue.stepId !== undefined && !ids.has(issue.stepId))) throw new Error("VERIFICATION_STEP_UNKNOWN");
  return verification;
}

const errorCatalog = {
  INVALID_INPUT: { message: "输入内容不符合要求，请检查后重试。", retryable: false },
  MODEL_UNAVAILABLE: { message: "指定模型暂不可用，请检查服务端配置。", retryable: false },
  MODEL_TIMEOUT: { message: "模型响应超时，请稍后重试。", retryable: true },
  MODEL_OUTPUT_INVALID: { message: "未能得到有效解题结果，请重试或补充题目。", retryable: true },
  TOOL_FAILED: { message: "辅助工具暂不可用。", retryable: true },
  TOOL_LIMIT: { message: "本次辅助工具调用已达到上限。", retryable: false },
  MODEL_LIMIT: { message: "本次解题轮次已达到上限。", retryable: false },
  VERIFIER_LIMIT: { message: "本次校验次数已达到上限。", retryable: false },
  RUN_TIMEOUT: { message: "本次解题已超时，请稍后重试。", retryable: true },
  CAPABILITY_DENIED: { message: "本次操作未获授权。", retryable: false },
  SPEND_LIMIT: { message: "解题额度不足，请先核对服务额度，再重新发起解题。", retryable: false },
  CANCELLED: { message: "本次解题已取消。", retryable: false },
  WORKER_LOST: { message: "解题任务意外中断，未自动重新执行。", retryable: false },
  INTERNAL_ERROR: { message: "服务暂时无法完成请求。", retryable: false },
} as const;
export const AgentErrorCodeSchema = z.enum(["INVALID_INPUT", "MODEL_UNAVAILABLE", "MODEL_TIMEOUT", "MODEL_OUTPUT_INVALID", "TOOL_FAILED", "TOOL_LIMIT", "MODEL_LIMIT", "VERIFIER_LIMIT", "RUN_TIMEOUT", "CAPABILITY_DENIED", "SPEND_LIMIT", "CANCELLED", "WORKER_LOST", "INTERNAL_ERROR"]);
export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>;
export const SafeAgentErrorSchema = z.strictObject({ code: AgentErrorCodeSchema, message: text(120), retryable: z.boolean(), traceId: IdentifierSchema }).superRefine((value, ctx) => {
  const safe = errorCatalog[value.code];
  if (value.message !== safe.message || value.retryable !== safe.retryable) ctx.addIssue({ code: "custom", message: "错误文案必须来自安全目录" });
});
export type SafeAgentError = z.infer<typeof SafeAgentErrorSchema>;
export function makeSafeAgentError(code: AgentErrorCode, traceId: string): SafeAgentError {
  return SafeAgentErrorSchema.parse({ code, ...errorCatalog[code], traceId });
}

export const RunStatusSchema = z.enum(["queued", "understanding", "solving", "verifying", "revising", "completed", "needs_clarification", "failed", "cancelled"]);
const eventFields = { schemaVersion: z.literal(1), runId: IdentifierSchema };
export const ToolSummarySchema = z.enum(["reading_resources", "calculating", "searching", "calling_approved_tool", "tool_completed", "tool_failed"]);
export const PublicToolEventSchema = z.strictObject({
  ...eventFields, type: z.literal("tool.status"), toolCallId: IdentifierSchema,
  toolName: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  status: z.enum(["started", "completed", "failed"]), summary: ToolSummarySchema,
}).superRefine((value, ctx) => {
  const valid = value.status === "completed" ? value.summary === "tool_completed"
    : value.status === "failed" ? value.summary === "tool_failed"
      : !["tool_completed", "tool_failed"].includes(value.summary);
  if (!valid) ctx.addIssue({ code: "custom", message: "工具摘要与状态不一致", path: ["summary"] });
});

/** Adapter events are NOT a raw SDK/SSE envelope: persistence assigns seq later.
 * No token/thinking/result fields or arbitrary summary strings can pass this union.
 * Final structured answers are emitted by the trusted orchestrator, not this stream. */
export const PublicAgentEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...eventFields, type: z.literal("run.status"), status: RunStatusSchema }),
  PublicToolEventSchema,
  z.strictObject({ ...eventFields, type: z.literal("run.error"), error: SafeAgentErrorSchema }),
]);
export type PublicAgentEvent = z.infer<typeof PublicAgentEventSchema>;

/** Internal phase transport. This is project data, not SDK state or a transcript. */
export const PhaseResultSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("solver"), candidate: SolverCandidateSchema, events: z.array(PublicAgentEventSchema).max(40) }),
  z.strictObject({ role: z.literal("verifier"), verification: VerificationSchema, events: z.array(PublicAgentEventSchema).max(40) }),
]);
export type PhaseResult = z.infer<typeof PhaseResultSchema>;

/** M0 in-memory outcome; M1 persistence/SSE must assign their own durable envelope. */
export const SolveOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal("completed"), candidate: AnswerCandidateSchema,
    verificationStatus: z.literal("not_requested").optional(), verified: z.boolean(), verification: VerificationSchema.nullable(), warning: AgentErrorCodeSchema.nullable() }),
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal("needs_clarification"), candidate: ClarificationCandidateSchema, verified: z.literal(false) }),
  z.strictObject({ schemaVersion: z.literal(1), status: z.enum(["failed", "cancelled"]), error: SafeAgentErrorSchema, verified: z.literal(false) }),
]).superRefine((value, ctx) => {
  if (value.status === "completed" && value.verification?.issues.some(issue => issue.code === "POLICY_VIOLATION")) {
    ctx.addIssue({ code: "custom", message: "违规候选不得作为答案发布" });
  }
  if (value.status === "completed" && value.verified && (value.candidate.figures?.length || value.candidate.problem.illustrations?.length || value.candidate.questions?.some(question => question.problem?.illustrations?.length)) && !value.verification?.checked.includes("diagram")) {
    ctx.addIssue({ code: "custom", message: "图示尚未独立校验" });
  }
  if (value.status === "completed" && (value.verified !== (value.verification?.verdict === "pass")
    || (value.verified && value.warning !== null)
    || (value.verification === null && value.warning === null && value.verificationStatus !== "not_requested")
    || (value.verificationStatus === "not_requested" && (value.verified || value.verification !== null || value.warning !== null)))) {
    ctx.addIssue({ code: "custom", message: "校验状态与证据不一致" });
  }
});
export type SolveOutcome = z.infer<typeof SolveOutcomeSchema>;

export const ProbeReportSchema = z.strictObject({
  schemaVersion: z.literal(1), mode: z.enum(["offline", "live"]), outcome: SolveOutcomeSchema,
  budget: z.strictObject({ modelAttempts: z.number().int().min(0).max(MAX_SOLVER_MODEL_ATTEMPTS), verifierAttempts: z.number().int().min(0).max(MAX_VERIFIER_MODEL_ATTEMPTS),
    fileAttempts: z.number().int().min(0).max(8), businessAttempts: z.number().int().min(0).max(8), searchAttempts: z.number().int().min(0).max(2) }),
  readCompleted: z.number().int().min(0).max(8),
});

export { problemText, answerText } from "./choice-presentation.js";
