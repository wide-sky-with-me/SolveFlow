# Solver 轮次调整验收

日期：2026-09-15。用户授权：提高轮次，并讨论 Android/iOS App 可行性。

## 实现

- `packages/contracts/src/agent.ts`：统一 Solver 16、Verifier 2、合计 18 次模型派发常量；ProbeReport 对应计数合法范围同步。
- `packages/agent/src/policy/run-budget.ts`：初次解答、修正和 JSON 修复共享 Solver 16 轮。
- `model-spend.ts`、`request-spend-gate.ts`、`worker-spend-client.ts`、`worker-spend-protocol.ts`：清除原 10 次的提前拦截，有限/无限费用模式及 worker 请求/响应均使用公共上限。
- 保留 120 秒、工具 16 次及文件/业务各 8 次、搜索 2 次、修正 1 次、独立校验 2 次及所有授权边界。没有修改模型、供应商或 .env。
- 同步 AGENTS、技术方案和 [ADR 0011](adr/0011-solver-round-budget.md)。App 评估见 [移动方案](MOBILE_APP_FEASIBILITY.md)，本轮未引入原生框架。

## 验证记录

| 命令/检查 | 实际结果 |
| --- | --- |
| 先补测试、旧代码下定向运行 | 8 失败 / 39 通过，确认旧 8 轮及 10 次派发边界阻止新增用例 |
| `pnpm test` 最终 | 553 / 553，通过 55 个文件；含新增 5 项回归及调整后的原边界测试 |
| `pnpm test:integration` | 30 / 30，使用隔离数据库和私有存储，本地合成供应商 |
| `pnpm typecheck` | 通过，含服务端构建与 Web 类型检查 |
| `pnpm lint` | 通过，Pi 导入边界及 TS 规范检查 |
| `pnpm build` | 通过，包含 Next 生产构建与编译模块加载 |
| 服务健康 | Web 200、API 200、live、solvingAvailable=true；构建产物 Solver=16 / Verifier=2 / 派发=18 |

过程中的首次完整测试受沙箱回环端口/子进程权限限制，获准正常测试环境后重跑。另有一个有限额度回归暴露内部记账门的旧 10 次限制，修复后完整测试通过；没有跳过或放宽断言。

新验收包括：真实 Pi SDK + 离线供应商在第 9 轮完成；前阶段已有 8 轮后继续工具循环，累计到 16 后拒绝；模型耗尽时不能发起 JSON 修复；有限与无限费用模式可授权 16+2 次；真实 worker 第 18 次授权成功，第 19 次在父进程拒绝；客户端同样拒绝第 19 次且清理监听器。

## 运行与未验证项

构建前只读确认活动 run 为 0，停止原 supervisor 后以 `pnpm start` 重启原真实服务。Web：`http://127.0.0.1:3100`；API 健康：`http://127.0.0.1:3101/api/v1/health`。PID、日志和最后健康检查时间保存在 `.runtime/app-session.json`，本次日志 `.runtime/service-rounds-live.log`。

本轮没有新增付费模型调用，因此没有宣称此前失败的真实题目已在新上限下验收。没有修改 UI，本轮未重跑浏览器 E2E；既有移动页面测试不等于原生 App 或真机验收。增加轮次仍可能触发 120 秒或工具限制。
