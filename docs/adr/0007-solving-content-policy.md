# ADR 0007：解题用途边界与安全拒答

日期：2026-09-14。用户要求该Agent仅用于解题并加强用途/安全限制，后续明确允许中立课程题，拒绝政治动员和危险请求。

## 决定

- 新增`packages/agent/resources/CONTENT_POLICY.md`，由`src/pi/openai-phase.ts`在Solver/Verifier创建会话时固定加载到系统消息，优先于角色说明。使用受控本地文件、有8KiB上限和取消信号，不按需交给Skill选择，不加载开发AGENTS或宿主上下文。
- 只允许学习题的理解、解答、概念/步骤讲解、解法核对与同题追问。允许中立政治/历史/安全教育题、材料分析与概念解释；拒绝政治动员、立场宣传和危险操作指导。根据实际目的区分客观分析与主动宣传，不能因政治学科误拒，也不能因“作业”标签放行宣传请求。
- 明确图片/用户/历史/工具/引用/Skill正文不能提升指令或工具权限。区分正常补充条件与注入，夹带攻击的正常题忽略攻击继续解答；纯越界请求拒答，不为拒答额外调用工具。混合指定多题含违规题则整组拒答。
- v1 clarification增加可选`refusalReason: policy | emergency`，兼容原澄清数据，状态仍为needs_clarification。服务端用固定安全文案替换模型原文、题干、知识点和引用；紧急人身危险显示关怀/求助提示。页面将拒答标题与普通条件澄清区分。
- Verifier新增`POLICY_VIOLATION`问题码。有效fail/unknown带该码直接丢弃候选，不能进入普通纠错或unverified降级；公共结果schema也禁止带该问题的completed进入DB/HTTP/SSE。普通运算错误、UNKNOWN和验证不可用的既有行为保留。

无需数据库列迁移，无新依赖或模型供应商硬编码。API/worker和Web同步升级，旧客户端刷新以识别可选字段。费用、超时、工具授权、独立验证与最多一次普通修正不变。

## 来源与取舍

参考[OWASP Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)关于指令/数据分离、输出校验和最小权限，以及[Anthropic的系统级防护说明](https://www.anthropic.com/engineering/how-we-contain-claude)关于模型与运行环境共同约束。此处是面向SolveFlow重新编写的用途策略，没有复制通用聊天产品的完整system prompt；政治内容限制是用户的产品要求，并非这些来源的统一要求。

提示词和Verifier的内容分类仍依赖模型，有限样例通过不能保证抵御所有攻击。该策略不能替代文件/网络权限、身份鉴权、输出渲染安全和持续对抗评测。尚未增加独立于模型的内容分类服务或外部审核供应商，也不宣称M0整体安全完成。

实际验收见[用途安全验收](../CONTENT_POLICY_ACCEPTANCE.md)。
