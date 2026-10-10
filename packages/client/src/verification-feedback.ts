import { makeSafeAgentError, type AgentErrorCode, type SolveOutcome, type Verification } from '@solveflow/contracts/agent';

const labels: Record<Verification['issues'][number]['code'], string> = {
  TRANSCRIPTION: '题目识别', LOGIC: '推理依据', ARITHMETIC: '计算', UNITS: '单位', DOMAIN: '取值范围',
  CITATIONS: '引用依据', DIAGRAM: '图形或读图', INSUFFICIENT_EVIDENCE: '条件不足', INVALID_CANDIDATE: '解答内容', POLICY_VIOLATION: '内容限制', OTHER: '其他疑点',
};
/** Describe recorded evidence; a transport/format failure is never an answer verdict. */
export function verificationFeedback(outcome: SolveOutcome, requestError?: AgentErrorCode) {
  const code = requestError ?? (outcome.status === 'completed' ? outcome.warning : null);
  if (code) return {
    title: code === 'MODEL_TIMEOUT' || code === 'RUN_TIMEOUT' ? '校验超时' : code === 'MODEL_OUTPUT_INVALID' ? '校验结果无法读取' : code === 'CANCELLED' ? '校验已取消' : '校验未完成',
    reason: code === 'MODEL_TIMEOUT' || code === 'RUN_TIMEOUT' ? '校验未在时限内完成，尚未得到本次校验结论。'
      : code === 'MODEL_OUTPUT_INVALID' ? '模型返回的校验内容不符合结果格式，无法据此判断答案对错。'
      : code === 'MODEL_UNAVAILABLE' ? '校验服务暂不可用，已保留解答；答案尚未验证。'
      : `${makeSafeAgentError(code, 'verification').message} 尚未得到本次校验结论。`,
    issues: [], next: '可点击“校验”重试；也可查看原图核对，或在下方继续追问。',
  };
  if (outcome.status !== 'completed' || outcome.verified || outcome.verificationStatus === 'not_requested') return null;
  const verification = outcome.verification;
  return {
    title: verification?.verdict === 'fail' ? '校验发现疑点' : '校验无法确认',
    reason: verification ? '以下是校验模型提出的问题，请结合原图核对：' : '这次记录没有可用的具体校验理由，无法判断答案对错。',
    issues: verification?.issues.map(issue => ({ label: labels[issue.code], message: issue.message })) ?? [],
    next: verification?.issues.some(issue => ['TRANSCRIPTION', 'DIAGRAM', 'INSUFFICIENT_EVIDENCE'].includes(issue.code))
      ? '请查看原图确认相关文字、数字或图形；可用“更正题干”补全条件后重新解答，或在下方继续追问。'
      : '可在下方针对这些疑点继续追问，或点击“重新解答”；识别有误时请先更正题干。',
  };
}
