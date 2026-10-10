# 按需回答与固定考试上下文

日期：2026-10-03。状态：implemented。回溯整理 2026-09-17 至 2026-10-02 已授权行为。

## 背景

用户要求先看简洁答案，需要时再取详细步骤和校验；随后授权考试默认值和批量自动独立核验。依据 [ADR 0015](../../../../docs/adr/0015-on-demand-answer-details.md)、[ADR 0017](../../../../docs/adr/0017-exam-default-and-preload.md)、[ADR 0018](../../../../docs/adr/0018-batch-solving.md) 与 [ADR 0022](../../../../docs/adr/0022-uat-uk-exams.md)。

## 决定

[本地引擎](../../../../packages/client/src/local-engine.ts) 从保存的题目/批次读取考试快照，单题默认 manual、批量 automatic；步骤、知识点和手动核验绑定原答案版本。考试通则和对应参考预加载，其他受审 Skill 按需读取。

## 放弃的方案

本地单题默认长答案和强制自动校验被用户的按需要求取代。默认考试设置不回写旧题，防止相同历史在设置变化后改用另一套规则。Pearson 播放器没有作为内部产品实体接入，其作用仅限外部官方样卷来源。

## 后果与限制

未请求核验不等于核验失败，更不等于已 verified；有效 PASS 才能设置该标记。默认值、批次和旧记录要分别验证。ESAT/TMUA/TARA 增强不代表其所有题型准确率已验收。

2026-10-04 的 [作答结构与材料决策](2026-10-04-exam-response-and-materials.md) 扩展完整源答案和同题材料快照；本篇的按需模式、考试默认值与外部题源边界继续有效。

## 验证

既有 [按需验收](../../../../docs/ON_DEMAND_ANSWER_ACCEPTANCE.md)、[考试主测](../../../../docs/UAT_UK_LIVE_EVAL_2026_10_02.md) 与 [失败修复记录](../../../../docs/MODEL_RELIABILITY_2026_10_03.md) 保留真实成绩。本次未新增付费调用。
