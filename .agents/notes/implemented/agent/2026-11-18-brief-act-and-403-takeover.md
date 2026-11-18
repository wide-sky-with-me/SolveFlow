# ACT 简洁模式单轮作答与上游 403 备用接手

日期：2026-11-18。状态：implemented。范围：设备与中心考试 ACT 简洁模式阶段、核验覆盖门槛及上游 HTTP 403 恢复边界。

## 背景

11 月 18 日线上数据库统计对比显示：979 道已完成 SAT 的草稿中位耗时为 10.4 秒、总完成中位耗时 18.1 秒（Solver 9.7 秒 + Verifier 6.6 秒）；同场 86 道已完成 ACT 的草稿中位耗时达 64.8 秒（p90 97.6 秒）、总完成中位耗时 93.1 秒（p90 122.5 秒）。拆解单次模型调用可见，[先行全文转录](2026-10-23-act-source-capture.md)要求逐字输出整篇阅读与整张表格的全部可见块，中位耗时 47.2 秒（另有 7 次在约 65 秒超时中断），随后再串行执行 15.7 秒解题与 22.5 秒五分项转录核验。同时，当日出现 20 次上游渠道返回 `HTTP 403`，因统一映射为不可恢复的 `CAPABILITY_DENIED`，未能切换到已配置的独立备用服务。

## 决定

[设备适配](../../../../packages/agent/src/pi/mobile.ts)在 `answerMode === 'brief'` 时跳过独立的 `captureAct` 全文转录阶段，直接将主图、补图及本轮缓存的[分区放大辅助视图](../../../../apps/mobile/src/local/act-transcription-views.web.ts)一并传入单轮 Solver；`answerMode === 'detailed'`（或未指定时）保留原有的先行全文转录与[题面绑定](../../../../packages/agent/src/pi/act-source.ts)。[ACT 参考](../../../../packages/agent/resources/skills/exams/references/act.md)与[主解题策略](../../../../packages/agent/resources/SYSTEM.md)在 `brief` 模式下只要求保留当前设问、所涉高亮原句或目标表行及完整原始选项，不再抄写无关段落与表行。

[核验覆盖契约](../../../../packages/contracts/src/agent.ts)与[核验策略](../../../../packages/agent/resources/VERIFIER.md)仅在候选显式标记 `transcriptionScope === 'act-visible'` 时强制检查五项 `actTranscription`；简洁单轮作答省略该分项表，直接核对原图设问、选项、`independentChoices` 与决定性依据。详细语义见[ACT 转录说明](../../../../docs/subsystems/act-transcription.md)。

[模型传输](../../../../packages/agent/src/pi/mobile-model.ts)在构造 `SolvePhaseError` 时记录 HTTP 状态码 `providerStatus`；[业务编排](../../../../packages/agent/src/orchestration/solve.ts)仅对携带 `providerStatus === 403` 的上游拒绝开放既有的一次独立备用 Solver 接手，并在自动核验遭遇上游 `HTTP 403` 时保留已生成的有效答案（标记未验证与 `CAPABILITY_DENIED` 警告）。本地工具/路径权限拦截与 `HTTP 401` 仍保持不可恢复。

## 放弃的方案

仅在保留双阶段全文转录的前提下关闭转录 thinking，仍需串行发起两次多图模型调用并等待数千字符无关原文生成，无法将简洁作答拉回与 SAT 同量级的单轮时延。把所有 `CAPABILITY_DENIED` 一律加入 `recoverable` 会削弱本地沙箱、路径校验与无效密钥（`HTTP 401`）的立即失败边界，因此只按受信传输层记录的 `providerStatus === 403` 精确放行。

## 后果与限制

`brief` 模式下的 ACT 结果不再生成 `transcriptionScope: 'act-visible'` 全文块，聚焦快速返回选项、核心条件与决定性依据；需要完整可见文章与整表逐字转录的场景须使用 `detailed` 模式。上游 `HTTP 403` 若在主服务与备用服务同时发生，仍按 `CAPABILITY_DENIED` 失败返回。本轮未自动发起真实付费模型测速，线上新题耗时待后续实考观测。

## 验证

`pnpm exec vitest run --project unit packages/contracts/src/act-transcription.test.ts packages/agent/src/` 与 `pnpm exec vitest run --project offline packages/agent/src/` 全部通过，覆盖 `brief` 单轮跳过转录、`detailed` 保留全文转录与局部复读、`act-visible` 核验门禁、上游 `HTTP 403` 一次备用接手、核验 `403` 保留答案及 `HTTP 401`/本地 `CAPABILITY_DENIED` 不恢复对照；`pnpm docs:check` 通过。
