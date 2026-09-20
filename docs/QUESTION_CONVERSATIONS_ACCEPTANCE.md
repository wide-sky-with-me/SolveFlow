# 按题持续对话验收（2026-09-14）

用户要求：追问与回复位于对应题目下面，持续向下展开，最终按题目分区。实现决策见 [ADR 0009](adr/0009-question-conversations.md)。

## 交付

- `apps/web/components/question-conversation.tsx` 与 `apps/web/lib/question-conversations.ts`：每题包含原解答、连续回复/澄清、进度、失败重试与输入框；步骤追问聚焦本题输入框。每题草稿独立，刷新后按持久化引用恢复已发送对话。
- `workspace.tsx`、`conversation-card.tsx`：移除页面末尾的公共追问区和游离进度/失败卡；取消结果同步进入会话快照，后续新任务不会使已取消任务重新显示为等待。
- `packages/contracts/src/run-context.ts`、`question-thread.ts`、`question-sections.ts`：共享题号/步骤归属及有界引用解析。reply接续已保存的回复，correction可定位原始多题中的某一题。明确的旧多题解析由前后端共用；未知归属不靠文本猜测。
- `packages/db/src/repository.ts`：保持owner/session权限及幂等校验，拒绝循环/无效/跨会话来源与未指定范围的原始多题reply。沿用已有context列，无数据库迁移。
- `apps/api/src/history.ts`、`worker.ts`及SYSTEM/VERIFIER：本题原始解答投影、本题历史与更正进入新一轮Solver/Verifier；其他题的更正不覆盖本题。既有安全策略、独立校验与调用预算保留。

## 测试

| 命令 | 实际结果 |
| --- | --- |
| `pnpm test` | 52文件、533项通过 |
| `pnpm exec vitest run --config vitest.integration.config.ts` | 28项通过，随机隔离数据库与私有桶 |
| `pnpm test:e2e` | 桌面/移动32项通过 |
| `pnpm typecheck`，最终新增测试后 `pnpm exec tsc --noEmit` | 通过 |
| `pnpm lint`、`pnpm build` | 通过 |
| `node --check scripts/question-thread-live.mjs` | 通过 |

新增浏览器场景：第1题草稿保持，第2题步骤追问→澄清→简短回复→失败→重试→再次追问；每次刷新后原解答与所有回复仍在各自题框中，320px无页面横向溢出，输入框边界位于本题容器内。该错误分支使用显式UI夹具，不冒充真实模型失败。

集成测试验证原始多题未选择题号的reply被拒绝、跨owner引用被拒绝；第1题更正不进入第2题的problemCorrection，第2题连续reply的历史保持当前题。

## 真实四轮交叉追问

`node scripts/question-thread-live.mjs --live` 显式执行，使用环境文件配置的实际模型/供应商，无硬编码/自动回退。自编两题：第1题 `3x−4=11`（x=5），第2题 `2x+3=9`（x=3）；真值由等式直接检查。

| 顺序 | 结果 | 耗时 |
| --- | --- | --- |
| 初次同时解答两题 | 两题真值正确，独立校验PASS | 24.007秒 |
| 第2题追问移项依据 | x=3，独立校验PASS | 9.665秒 |
| 切到第1题追问代回 | x=5，独立校验PASS | 4.641秒 |
| 回到第2题继续追问 | sourceRunId指向第2题上次回复；x=3，独立校验PASS | 5.160秒 |

四个run展示为两个题目容器：第1题两轮内容、第2题三轮内容（原始多题run分别投影到各题）。刷新、归属、320px布局及浏览器无运行异常检查通过，自编会话已删除。结果 `.runtime/question-thread-live.json`，截图 `.runtime/screenshots/question-thread-live-mobile.png`。

真实服务已恢复 `http://127.0.0.1:3100`，当前进程与日志记在 `.runtime/app-session.json`。已有任务次数/时限不变，未宣称无限历史或每题并发。无明确来源的旧多题追问仍保留独立记录；模拟移动视口不等同于手机真机相机验收。
