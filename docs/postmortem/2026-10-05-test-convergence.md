# 全项目测试入口与分层收敛验收

日期：2026-10-05。

范围：根测试命令、Vitest 项目分组、Playwright 功能/性能配置、CI 与当前测试指南；没有修改产品代码、题目数据、既有断言或验收阈值。

结论：保留原全量入口，按运行责任提供定向入口；完整收集列表没有漏收或重复。执行证据仅代表下列实际范围。

## 变更与处理

[测试分组](../../tests/test-suites.ts)拥有离线文件和浏览器性能模式；[Vitest](../../vitest.config.ts)将实际 SDK 会话、MCP 回环、worker 与管理子进程归入 offline，其余归入 unit。[根命令](../../package.json)的 `test:unit` / `test:offline` 沿 `test` 先构建再筛选，全量默认仍执行两组，最多两个 worker。

功能与性能配置复用[浏览器配置](../../playwright.config.ts)的设备、单 worker、超时及断言。`test:e2e` 仍含完整集合，两个新入口只筛选文件；性能文件中的正确性回归仍保留。[CI](../../.github/workflows/ci.yml)在 typecheck 构建后分别执行两组 Vitest。数据库、原生与真实模型维持显式入口和原授权要求，语义见[测试指南](../testing.md#入口与分层)。

## 验证结果

最终检查使用 Node 24.19.0、缓存 pnpm 11.7.0；编辑前快照、原收集列表、JSON 比对、日志和服务记录保留在 `.runtime/test-convergence-2026-10-05/`。

| 实际检查 | 结果 |
| --- | --- |
| Vitest 改动前后 `list --filesOnly --json` 比对 | 原 105 文件完整保留；unit 70 + offline 35，交集与遗漏为零 |
| `pnpm exec vitest run --project unit --maxWorkers=2` | 70 文件、557 项通过，退出 0，受限沙箱可执行 |
| `pnpm test:offline` | 实际执行共享构建及 alias 转发；35 文件、347 项通过，退出 0，使用已授权本机回环/子进程权限 |
| 浏览器全量及两个新入口 `--list --reporter=json` 比对 | 原 248 项完整保留；功能 228 + 性能 20，交集与遗漏为零；收集不是执行成绩 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:56333 pnpm test:e2e:functional tests/mobile-e2e/verification-coverage.spec.ts tests/mobile-e2e/workspace.spec.ts` | 核验覆盖、拍照/追问/刷新/删除及选图旋转，桌面/窄屏 10 项通过，退出 0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:56333 pnpm test:e2e:performance` | 完整性能组桌面/窄屏 20 项通过，退出 0；保留输入序列化、页缓存、冷页、绘制回退及 100 题突发断言 |
| `pnpm exec tsc --noEmit` | 退出 0 |
| `pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2024 --skipLibCheck --strict vitest.config.ts playwright.config.ts playwright.functional.config.ts playwright.performance.config.ts` | 配置文件类型检查退出 0 |
| `pnpm lint` | 源码边界与文档检查退出 0 |
| `pnpm docs:test` | 授权本机子进程后 20 项通过，退出 0；受限沙箱初次 Node runner 退出 1，日志保留，未修改断言 |
| `git diff --check` | 退出 0 |

浏览器使用本轮自建服务 PID 4066324、URL `http://127.0.0.1:56333`，复用上一轮同一 Web 产物；配置整理没有重新构建产品。性能组按单 worker 独立于功能组运行；此轮验证入口和既有门槛，不宣称性能改善或 Android 帧率。结束后服务会话退出 0，本轮临时 pnpm 包装已清理。

## 未验证项与剩余风险

未运行全部 228 项浏览器功能，仅验证代表场景；未执行远端 CI、数据库/对象存储集成、APK 编译/安装、真机或真实付费模型。分组按文件职责维护，性能文件中还含正确性回归；未来新增资源依赖须检查归属与收集集合。
