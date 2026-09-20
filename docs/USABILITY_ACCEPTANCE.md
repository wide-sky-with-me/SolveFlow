# 可用性增量验收（2026-09-14）

本轮按[可用性评审](USABILITY_DESIGN_REVIEW.md)实施优先链路，决策见 [ADR 0008](adr/0008-learning-continuity.md)。已完成上传前裁切、原图放大、澄清续答、历史答案保留、按题/步骤追问、题干更正与版本对照；不是评审全部后续项目完成。

后续按用户要求将逐轮卡片改为题内持续对话，新增reply与题内更正范围；见 [按题对话验收](QUESTION_CONVERSATIONS_ACCEPTANCE.md)。以下为首批历史验收记录。

## 实现

- `apps/web/components/workspace.tsx`、`conversation-card.tsx`、`answer-content.tsx`：同题答案与澄清按轮展示，进行中/失败/刷新保留原结果；新旧结果分别显示校验状态。单题和多题统一先教学步骤再结论。题内/步骤按钮定位追问；识别题干可查看、更正，旧版有明确提示。未验证结果展示核验疑点。
- `image-editor.tsx`、`apps/web/lib/image-crop.ts`：上传前用原始像素裁切，支持鼠标/触摸框选与键盘边界滑块；私有原图可放大到300%。无需新增依赖；服务端继续真实解码、像素限额、EXIF清理和私有存储。
- `packages/contracts/src/run-context.ts`、`http.ts`、`agent.ts`：增加可选的版本/题目/步骤引用及服务端解析的学习上下文。`packages/db/src/repository.ts` 校验同 owner、同 session、有效结果和引用；上下文进入幂等散列。会话容量、滚动日限制、存储容量有不同错误码和行动提示。
- `packages/db/migrations/0002_run_context.sql`：新增可空 context；迁移逐份校验 hash，旧结果和账本均未覆盖。已应用到本地数据库，启动校验版本2。
- `apps/api/src/history.ts`、`worker.ts`：历史包含待确认问题、教学步骤节选和原结果是否校验；“3”等简短回复可对应上轮问题。最新更正全文持续进入后续 Solver/Verifier；定向引用由已授权结果解析，使用有界节选。SYSTEM/VERIFIER 明确上下文用途及数据不具备指令权限，每次新解答独立校验。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `pnpm test`，补充最后2个回归后 `pnpm exec vitest run` | 最终51文件、529项通过 |
| `pnpm exec vitest run --config vitest.integration.config.ts` | 27项通过，随机隔离 PostgreSQL / MinIO |
| `pnpm test:e2e` | 桌面/移动共30项通过，含320px、裁切后真实上传、定向追问、题干更正、失败与刷新保留旧答案 |
| `pnpm lint` | 通过 |
| `pnpm typecheck`，新增测试后 `pnpm exec tsc --noEmit` | 通过 |
| `pnpm build`，最终版本文案补充后 `pnpm --filter @solveflow/web build` | 通过 |
| `node --check scripts/usability-live-acceptance.mjs` | 通过 |
| 真实 Web/API 健康、迁移版本1/2、自编测试会话删除 | 通过 |

首次普通沙箱执行测试因本地端口等权限失败，获取本地测试权限后通过。首轮E2E为29/30：懒加载题图移到下方后，旧测试在滚动前立即判断图片已解码；已改为实际滚动到题图并等待解码，保留图像确实加载与安全链接断言，最终30/30通过。

## 真实模型四轮验收

命令：`node scripts/usability-live-acceptance.mjs --live`。使用 `.env` 中实际配置的供应商/模型，不硬编码或自动回退；无限金额模式，保留单任务120秒及其他能力预算。自编题为 `ax+3=9`，明确缺少系数，后补充与更正系数；数学真值直接由等式检查，不只依赖模型判卷。

第一次验收在首轮约19.045秒收到未完成响应，安全诊断为 `INCOMPLETE_RESPONSE / stopReason=error`，对外失败码为 `INTERNAL_ERROR`，没有伪装为答案。未记录提供商原始错误正文，因此不能据此认定具体HTTP状态或断言是额度原因。失败报告保留在 `.runtime/usability-live-*.json`，对应日志 `.runtime/usability-live.log`。

保留失败后的一次有限重验完成：

| 轮次 | 验收行为 | 结果 | 耗时 |
| --- | --- | --- | --- |
| 1 | 请求确认缺失的系数a | needs_clarification | 2.661秒 |
| 2 | 仅回复“3” | x=2；独立校验PASS | 6.669秒 |
| 3 | 更正为a=2，其余条件不变 | x=3；新解答独立校验PASS | 8.230秒 |
| 4 | 点击新版答案的具体步骤并追问依据 | 引用版本/步骤一致；独立校验PASS | 5.732秒 |

刷新后四轮结果保留，旧版答案内容未被更正覆盖；320px横向布局检查通过。自编测试会话已删除。完整重验结果 `.runtime/usability-live.json`，运行日志 `.runtime/usability-live-retry.log`，自编题移动截图 `.runtime/screenshots/usability-live-mobile.png`。真实服务已恢复在 `http://127.0.0.1:3100`；当前 supervisor 与日志记录在 `.runtime/app-session.json`。

## 尚未完成

- 自动题目边框/分题、透视矫正、HEIC转换、iPhone/Android真机相机验收；目前为浏览器模拟移动视口，不宣称真机验收。
- 图示嵌入指定步骤、更多几何图形、每题独立校验状态和单题重试；旧多题协议仍最多4题、总16步骤/3图。
- 科目专项 Skill、生产搜索/MCP、隔离数学服务、PWA与公网发布，仍按原安全验收推进。
- 对话和任务仍有界：单会话10次、滚动24小时30次任务；失败/澄清也计入当前任务次数。额度无限仅指金额。多次局部更正跨越历史截断边界时可能需用户重新确认完整条件。
- 上游异常目前仍可能统一映射为 INTERNAL_ERROR，尚未细分提供商繁忙/连接失败等所有用户提示；本轮没有宣称消除提供商响应波动。
