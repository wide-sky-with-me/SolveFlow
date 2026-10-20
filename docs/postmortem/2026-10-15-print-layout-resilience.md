# 整理失败的可见重试与部分结果续做

日期：2026-10-15，00:44起（Asia/Shanghai）。

范围：本机3100入口、显式导出整理；独立浏览器合成题库与模型响应，不操作原 Windows Chrome 的题库、缓存或配置。

结论：已实现单条最多三次、取消感知退避、尝试数/脱敏原因展示和部分成功后续做；55项单元、28项合成浏览器回归通过。单条或合成数据不代表27题真实整批完成。

## 变更与处理

截图为无效内容，已显示24题待整理；当前旧代码只对 JSON/结构追加一次，归属和传输失败直接终止。服务记录的4次 HTTP200/completed只证明传输完成，未携带客户端具体校验原因，不能据此判定每条的尝试次数。

[适配](../../packages/agent/src/pi/batch-print-layout.ts)新增明确开关与最大尝试数，显式入口启用三次，覆盖格式、结构、归属不匹配、连接异常和限流。前两次失败各退避1秒、2秒，所有尝试共用原总截止，SDK重试仍零。逐次清除失败状态与上下文，保留原图、模型、输出额度和严格校验；截断、超限、取消、永久配置错误不追加。

[运行入口](../../apps/mobile/src/runtime.ts)在原进度区显示等待与尝试数，耗尽后错误显示实际次数和有界字段路径。[编排](../../apps/mobile/src/local/prepare-paper-batch.web.ts)成功后仍逐条保存，重复点击只处理剩余，刷新/导出/存储重试不请求模型。取舍见[决策](../../.agents/notes/implemented/agent/2026-10-15-print-layout-resilience.md)，前次结构实测见[原报告](2026-10-14-print-layout-format-retry.md)。

## 验证结果

- 新10项韧性回归在旧实现上首次7失败，3项永久错误通过，附带6个测试断言延迟处理的拒绝提示；没有真实模型调用。实现后同组全部通过，没有未处理错误。
- `pnpm exec vitest run packages/agent/src/pi/batch-print-layout.test.ts packages/agent/src/pi/batch-print-layout-normalization.test.ts packages/agent/src/pi/batch-print-layout-retry.test.ts packages/agent/src/pi/batch-print-layout-resilience.test.ts apps/mobile/src/local/prepare-paper-batch.test.ts`：55项通过，退出0。第三次恢复、归属/网络/限流、取消退避、共享截止及既有缓存行为均覆盖。
- 首次构建因 exactOptionalPropertyTypes 的可选诊断字段传入 undefined 退出2；改为按存在性展开字段，复测 `pnpm build:web` 与 `pnpm --filter @solveflow/mobile typecheck` 退出0。
- 首次浏览器回归的旧断线次数与进度断言冲突，停止该轮；更新为三次总上限和完整新进度后，`pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts --config playwright.config.ts --output .runtime/print-retry-2026-10-15/e2e-final`：28项通过、退出0。包含桌面和模拟窄屏的第三次恢复、错误披露、缓存保留及刷新续做。
- 原生 Python Playwright 检查先在 networkidle 后过早读取启动屏而显示未就绪；显式等待启动屏隐藏后通过，真实首页加载主包 index-25d2d29db7505e2eba4e64662c9c0869.js，观察到零模型分发。
- `pnpm lint`、`pnpm exec tsc --noEmit`、`git diff --check`：退出0；首页HTTP200并引用新主包。既有3100服务保留，未新启生产入口。

## 未验证项与剩余风险

原 Windows 浏览器的实际付费整理、27题真实整批、真实识别及裁片质量未验。本轮无额外付费请求，无远端部署、提交、推送或题库修改。每条最多产生三次请求费用；持续故障仍会耗尽并停止，可再次显式继续待整理记录，已成功缓存保留。
