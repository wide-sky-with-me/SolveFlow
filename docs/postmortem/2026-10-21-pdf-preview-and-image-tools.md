# PDF 预览重叠与图片操作区修复

日期：2026-10-21，Asia/Shanghai。基线为main `4f7f8d7`及既有未提交改动；继承[上轮UI调整](2026-10-21-pdf-header-ui.md)，不提交、推送或付费调用。

## 问题与修复

[屏幕预览](../../apps/mobile/src/components/batch-pdf-dialog.web.css)复用了固定单页高度，但没有打印阶段的缩放适配；长说明溢出正文后压住页脚及下一题。现在预览按内容自然展开，页间保留分隔，窄屏标题和图片适配宽度。规则仅在预览祖先下生效；导出克隆不带该祖先，继续按[单题A4适配](../../apps/mobile/src/local/print-question-pages.web.ts)限制字号与页数。

[图片面板](../../apps/mobile/src/components/batch-pdf-panel.web.tsx)先排列题目/归属及本题操作；重新整理本批、更新本批清晰化移入独立的“本批操作”栏，不再让批量按钮挤在当前题目选择上方。现有取消、禁用、保存与调用条件保持。当前语义见[批次PDF](../subsystems/batch-pdf.md)与[题图处理](../subsystems/print-images.md)。

## 验证

Node24.19.0、pnpm11.7.0；合成题图、fake模型与隔离IndexedDB。测试入口`http://127.0.0.1:45929`，PID1538111。日志、截图及产物在`.runtime/pdf-preview-ui-2026-10-21/`。

- 修复前合法长说明回归：桌面1通过、窄屏1失败，退出1；窄屏页脚间隔为−509.3125px，证据为repro.log。首次夹具曾因单条说明超过500字符而失败，未进入几何断言，另留before.log。
- `CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/pdf-preview-ui-2026-10-21/web`：退出0。
- `CI=1 SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45929 pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts --grep 'long preview notes|a fitted question keeps|print stems preserve|print notes render|explicit enhancement preserves|reprocesses only the current|busy progress and cancellation' --reporter=line --output=.runtime/pdf-preview-ui-2026-10-21/browser-results`：16项通过，退出0，含2项新增长预览回归。
- 为图片分组补充边界断言及浅/深色截图后，仅筛选`reprocesses only the current`复测：2项通过，退出0；不与前16项累加。人工查看桌面1440×1000、窄屏390×844的预览页界及操作分组截图。
- `pnpm exec vitest run --project unit --maxWorkers=2 packages/client/src/batch-print-variants.test.ts apps/mobile/src/local/print-question-pages.test.ts`：2文件15项通过，退出0。
- `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm lint`：最终均退出0。根类型入口首次在pnpm依赖预检阶段因ENOENT退出，未运行tsc；串行重跑通过，原日志保留。

覆盖预览页脚不被正文压住、下一题不重叠、完整说明保留、图片分组不横溢、当前题重整、整批清晰化及补存、PDF下载页数、打印最低字号/页脚间隔和短屏取消。未做真机、APK/iOS或真实模型调用，不将预览展开视为取消PDF内容容量限制。

## 选错题规则与本地交付

核对[规划器](../../packages/client/src/batch-print-variants.ts)：由本地确定性规则选题及替换选项，不由Agent临时随机挑选。原标红计入最终错题总数，增加部分从有有效参照且可改写的题目选择；多份优先不同组合，不足才复用。未校验作答默认计对属于导出假定，不是正确性证据；历史答案不改。本轮未修改该算法。

已更新现有`http://127.0.0.1:3100`，新增两个哈希资源后原子切换入口，保留旧资源与入口备份，不重启服务或操作用户历史。首页及19项资源返回200，路径与入口哈希见publication.json；用户刷新生效。测试PID和45929端口已清理，见cleanup.json；3100继续运行。
