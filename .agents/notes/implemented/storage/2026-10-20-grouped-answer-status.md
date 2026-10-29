# 多题历史状态按线程汇总并重建旧摘要

日期：2026-10-20。状态：implemented。范围：题目线程、历史投影与设备派生摘要。

## 背景

功能审查复现：同图两题只校验第一题，历史卡片却显示整图通过；只重做并校验第二题也会掩盖第一题未验证。原[四态机制](../architecture/2026-10-08-answer-checkpoint-queues.md)按当前答案及独立校验计算，直接对整图运行列表取最后答案不足以说明多个线程的状态。

另外，步骤/知识点输出含合法questions字段时，[分题投影](../../../../packages/client/src/question-conversations.ts)会把辅助内容拆成新题。辅助结果属于源答案，不能新增可切换题目。

## 决定

[历史入口](../../../../packages/client/src/history-payload.ts)复用既有线程分组，分别计算状态再汇总：全部通过才绿；任意失败/待关键补充为红；否则已有答案为橘，完全无答案为灰。题内分页仍显示各自状态，不重写run的verified。

[摘要契约](../../../../packages/contracts/src/local.ts)添加可选answerStateVersion，当前算法版本为2。[仓库](../../../../packages/client/src/local-repository.ts)不信任缺少当前标记的旧派生状态，从题目元数据重建一次；之后复用缓存，不额外读取分离的图片文档，不改原图/答案、格式版本或备份。历史读取、导入及恢复沿既有边界。

辅助结果的questions保留原值，但不作为新线程根拆分；[引用解析](../../../../packages/contracts/src/question-thread.ts)也沿辅助祖先回到源题，步骤追问和核验不因示例题号改换线程。已有步骤ID、owner/会话、深度与无环校验继续生效。普通作答仍按原规则分题；不扩大题数、模型调用或权限。

## 放弃的方案

忽略带题号的手动校验虽避免误绿，却无法在所有分题分别通过后显示整图通过。始终重读全部元数据会失去摘要缓存收益。只改计算而不标记派生版本，会继续展示磁盘中的旧误绿状态；因此选择一次重建。

## 后果与限制

首次读旧摘要需额外读元数据并写派生缓存，I/O故障继续报错；健康新缓存不读题目原文。旧客户端严格schema可能拒绝新增摘要字段，沿用项目不支持降级覆盖的限制。此决定细化四态机制的多题范围，其余检查点/取消语义保持。

## 验证

[历史投影回归](../../../../packages/client/src/history-payload.test.ts)复现部分校验和单题重做误绿；[仓库回归](../../../../packages/client/src/local-history.test.ts)核对旧摘要重建、原字节不变及二次读取无元数据扫描；[辅助分题回归](../../../../packages/client/src/question-conversations.test.ts)核对页数与普通追问目标。实际成绩与范围见[功能审查](../../../../docs/postmortem/2026-10-20-functional-logic-review.md)。
