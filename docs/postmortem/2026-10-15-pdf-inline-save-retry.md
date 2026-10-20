# 前台成品保存直接恢复

日期：2026-10-15。范围：原本机 `http://127.0.0.1:3100/`、Linux Chrome、隔离浏览器。未提交、推送、部署到 Mac 或修改全局配置。

结论：成品保存失败后，原弹窗现显示“重试保存并下载”和“取消本次导出”，避免误触重新绘制。新增桌面／窄屏八项与原有 88 项回归通过；真实批次连续保存失败后恢复原方案，54 页 A4 已核验。整体生产验收继续。

## 行为与边界

[导出弹窗](../../apps/mobile/src/components/batch-pdf-export.web.tsx) 记录本次接受的任务 ID，订阅任务状态；仅当该任务已有生成结果且等待保存时切换恢复操作。恢复直接使用原任务、原成品和原计划，不再调用准备或生成器，不依据后来编辑的份数重建，也不猜测其它任务。保存成功后发起下载；取消待保存成品走既有队列取消和清理。

恢复中保持进度、明确取消、Esc 门禁与原主题。业务操作沿用既有同步 working 门闩，快速重复点击不会创建并行保存或重复下载。导出记录入口继续可用；关闭弹窗后仍可由记录管理恢复，重开弹窗不擅自认领旧任务。

[下载适配](../../apps/mobile/src/local/web-export-tasks.ts) 增加兼容的可选取消信号，在读取成品前后检查。取消发生于文件写入途中时，既有任务层完成取消清理；发生于成功入库后的读取途中时，阻断下载，不回滚已成功的任务或文件。未改共享任务契约、数据库版本、渲染、图示像素、质量或容量上限。取舍补入[既有决策](../../.agents/notes/implemented/storage/2026-10-14-background-pdf-exports.md)。

## 复现与回归

[后台导出测试](../../tests/mobile-e2e/background-exports.spec.ts) 注入文件存储配额异常。旧构建能报保存失败，但没有弹窗重试按钮；`--grep 'inline file recovery retry ' --project=desktop` 退出 1，证据在 `.runtime/pdf-production-2026-10-15/e2e-inline-r13-red/`。

首次类型检查发现新测试未缩窄数组首项与探针的 unknown 返回，退出 2；按真实类型守卫修正，未掩盖接口或抑制错误。随后 `pnpm exec tsc --noEmit && pnpm --filter @solveflow/mobile build:web` 退出 0，JS 为 `index-d4352b02576577523563795c5e9fabaa.js`，既有 CSS 未变。Node 24.21.0 与声明的 24.19.0 有版本警告，不影响退出码。

`pnpm exec playwright test --config=playwright.functional.config.ts tests/mobile-e2e/background-exports.spec.ts --grep 'inline file recovery' --workers=1 --max-failures=1 --output=.runtime/pdf-production-2026-10-15/e2e-inline-r13-green`：八项通过。连续两次保存失败保留原任务，改份数后恢复仍为原计划；快速双击只下载一次。另覆盖保存途中取消、读取途中取消及主动放弃。每例验证单任务 ID、份数、文件与 sizes 账本、打印 frame 释放、原题不变及零模型请求。

取消探针仅延迟隔离上下文中已完成的 IndexedDB 回调，在存储适配期限内释放，不修改正常 CSP 或产品期限；不将浏览器窄屏当作真机。`pnpm exec playwright test --config=playwright.functional.config.ts tests/mobile-e2e/background-exports.spec.ts tests/mobile-e2e/paper-preparation.spec.ts --grep-invert 'inline file recovery' --workers=1 --output=.runtime/pdf-production-2026-10-15/e2e-inline-r13-regression`：原有 88 项通过，退出 0。本轮合计 96 项独立浏览器场景，不重复累计。

`pnpm lint`（含 `pnpm docs:check`）与 `git diff --check` 均退出 0。文档检查为 189 份当前文档、60 份决策、120 个源码锚点、108 份冻结文档；未提高长度门槛或修改冻结历史。

## 真实批次

`python .runtime/pdf-production-2026-10-15/accept-inline-save-round13.py` 退出 0。从独立 QA 浏览器复制真实 27 题到新上下文，两份原作答连续模拟两次保存失败；把当前份数改为一份，再于原弹窗重试，仍下载原两份 ZIP：两份 PDF 各 27 页，共 54 页 A4，13,131,162 字节。新任务始终只有一个、ID 与接受份数不变。生成 frame 始终为两次，保存尝试三次，最终仅一次下载；模型请求、浏览器异常和残留 frame 均为零。

390×320、390×844、844×390 深色视口的恢复与取消按钮均完整可见，短屏和横屏截图已查看。第二次失败仍聚焦错误并允许再次恢复。下载 ZIP 的 SHA-256 为 `465d8fd8d78b2d7bea3ff1e69860bb1af6b7f224f49529a8dfdd9bd7e29a5208`，与 IndexedDB 中保存字节一致；原题与整理缓存摘要精确不变。证据在 `.runtime/pdf-production-2026-10-15/inline-r13-accepted/`，含结果 JSON、截图与 ZIP。与合成回归使用独立浏览器上下文，只验证恢复及成品，不作耗时比较。

## 后续

重试保存明确沿用先前已生成文件。若要按新设置导出，应先取消本次待保存导出，再重新生成。记录元数据、清理等非成品保存故障仍通过导出记录处理；刷新或关闭浏览器不会恢复内存中的待保存文件，也不自动重放模型。

本轮不代表整体验收完成。照片残边、邻题碎片、透视、持续负载、实体打印及屏幕阅读器实际朗读仍待验证；[失败反馈验收](2026-10-15-pdf-failure-feedback.md) 保持当时范围和成绩。
