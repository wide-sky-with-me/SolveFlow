# 整理生成视图与保存契约分离

日期：2026-10-15。状态：implemented。范围：显式题目整理的模型生成 JSON Schema。

## 背景

真实27条批次在首条连续三次失败：冗余 problem.illustrations 的 alt 超长、数量超限，以及 problem.response.parts 为空。后者是作答格式元数据，并非渲染富文本。完整 ProblemStatementSchema 支持这些可选字段，但整理不需要重复输出解题元数据或题干坐标图。

## 决定

[生成视图](../../../../packages/agent/src/pi/batch-print-layout-generation.ts)从既有字段定义派生精简 problem，仅包含 text、subject、uncertainties、sourceNumber、options、optionsComplete。题干小问、材料、作答要求仍完整进入 text，图示仅由 sources.regions 定位；alt 保持300字符上限并提示使用简短图名。

[模型适配](../../../../packages/agent/src/pi/batch-print-layout.ts)仅更换发给模型的生成 Schema；输入仍保留完整保存参考，接受响应仍经过完整 BatchPrintLayoutSchema 和 parseBatchPrintLayout。原数据库、缓存、图源归属与不完整内容保留规则不改变，不从错误响应中猜测或搬移图框。

## 放弃的方案

放宽题干图示数量或 alt 长度会掩盖双轨坐标问题；在归一化时删除所有未知/无效字段会隐藏模型错误。均未采用。继续把全部解题可选字段发送给整理模型已经被真实三次失败反证；对生成视图做限制，比扩大存储契约更精确。

## 后果与限制

模型仍可能偏离生成视图，届时完整契约继续终止无效输出，保留三次总上限。精简字段不是精简题干，小问和作答要求需以原文本完整表达；实际识别和图框质量仍需人工/实图核查，不用 Schema 通过宣称质量合格。

## 验证

[生成视图回归](../../../../packages/agent/src/pi/batch-print-layout-generation.test.ts)先复现旧视图暴露 response/illustrations，修正后检查精简字段及保存契约仍保留原字段。63项提取/重试/归属回归通过；真实验收与其它检查见[持续验收](../../../../docs/postmortem/2026-10-15-pdf-production.md)。
