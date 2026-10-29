# 跨批次等待隔离与任务快照

日期：2026-10-28。状态：implemented。范围：设备批量队列、任务总览与PDF入口。

## 背景

多个批次复用运行时，但全局停止标记、启动失败后的全队列清空和PDF入口的全局忙碌判断使无关批次相互影响。另一个批次也会占用全部题图等待容量。既有[独立并发决定](2026-10-09-independent-batch-concurrency.md)的答题/校验分池及[范围停止决定](../storage/2026-10-10-scoped-history-and-batch-edit.md)仍有效。

## 决定

[队列](../../../../packages/client/src/local-batch.ts)按批次维护停止标记与启动错误；停止同一范围共用收尾Promise，启动失败仅移除本批等待项。存储故障沿全局阻塞与手动恢复。尚未接受的等待项保留ID和请求描述，上限关联本地记录容量；已接受输入仍保持原独立上限，泵在上限前暂停派发。

用不可变、稳定引用的[共享快照](../../../../packages/contracts/src/local.ts)发布等待、答题、校验、补图准备和范围停止状态。[总览](../../../../apps/mobile/src/components/batch-task-center.tsx)合并历史摘要，不读取图片；[批次页](../../../../apps/mobile/src/components/batch-workspace.tsx)仅以自身忙碌状态限制本地PDF入口。每张题图当前阶段优先于旧答案，避免重答双计。当前语义见[批量任务](../../../../docs/subsystems/batch-tasks.md)。

## 放弃的方案

保留全局停止/清空会继续干扰其他批次；仅提高全部已接受任务上限会增加解码图片与核验输入内存，因此只扩大尚未派发的ID队列。无限等待违反资源边界。独立每批模型池会放大供应商并发，不采用；仍共用设置与存储锁。

## 后果与限制

这是对旧决定中“入口和引擎共用单批总量”的局部替代，既有执行并发、核验、取消优先与存储保护不变。逻辑隔离不等于独立存储或供应商资源。队列不持久化，不自动恢复付费任务；Web关闭页面仍中断。普通会话与模型重识图沿既有准入。

## 验证

[跨批次回归](../../../../packages/client/src/local-batch-isolation.test.ts)覆盖启动失败、范围停止、阶段快照和120张跨批等待；[汇总回归](../../../../apps/mobile/src/batch-task-summary.test.ts)覆盖旧答案与运行状态去重。[浏览器回归](../../../../tests/mobile-e2e/batch-tasks.spec.ts)及真实执行范围见[本轮验收](../../../../docs/postmortem/2026-10-28-multi-batch-tasks.md)。真实模型、Android与iOS原生未在本轮验收。

2026-10-28：[取消与预检补充](2026-10-28-batch-stop-and-export-preflight.md)修正等待他批补图的取消边界，并将答案可用性与运行阶段分开；本篇共享并发、输入容量及全局存储保护保持。
