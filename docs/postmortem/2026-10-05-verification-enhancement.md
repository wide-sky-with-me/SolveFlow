# 复杂作答核验覆盖与时间增强验收

日期：2026-10-05。

范围：当前工作区的共享核验契约、设备模型阶段与保留服务编排；离线合成题图、假模型和模拟时钟。没有调用真实模型或安装手机。

结论：已补逐题/逐小问覆盖门槛和结构化作答时限；不以离线测试声明真实超时率或准确率已改善。

## 变更与处理

新增有界可选 coverage，旧记录保持可读。新执行的多题/小问核验只有完整对应原标签且各项实际完成转录和逻辑/运算检查才可 PASS。缺项、串题、重复、额外项或无法判断降为 UNKNOWN，保留真实 FAIL 与一次修正。共享编排也执行实质检查，防止服务路径仅凭转录发布 verified。

设备识别短作文、写作、小问、多题内部长文和化学结构，按已有总预算分配校验时间；AP/TARA/补图自动路径增加预留。详细运行语义见[Agent](../subsystems/agent.md)，代价与兼容见[决策](../../.agents/notes/implemented/agent/2026-10-05-verification-coverage-and-time.md)。学生指令要求从原图独立识别覆盖范围，短输出不代替实质核验。

## 验证结果

命令、日志和编辑前快照保留于忽略目录 `.runtime/verification-enhancement-2026-10-05/`。初次复现使用默认 Node 24.21.0，最终检查使用项目指定 Node 24.19.0 与缓存 pnpm 11.7.0，临时 PATH 包装不改变全局工具。

首次新增回归在修改前 12 失败、1 通过，退出 1；复现全局 PASS 放行缺小问/无实质核验，以及短作文错误使用普通时限。第一轮实现后相关六文件 120 项通过，退出 0。另补模拟剩余 50 秒的小问修正场景，先复现窗口被预留耗尽的失败，随后将修正预留限制为剩余时间一半；原失败日志保留。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 最终共享包、根与移动端类型检查退出 0；首次默认 pnpm 启动器因只读 store 锁退出 1，改用缓存指定版本 |
| `pnpm exec vitest run --maxWorkers=2` | 最终 105 文件、904 项通过，退出 0；新增 27 项覆盖与时间场景 |
| `node node_modules/vitest/vitest.mjs run packages/agent/src/pi/verification-reliability.test.ts packages/contracts/src/verification-coverage.test.ts packages/agent/src/pi/verification-coverage.test.ts --maxWorkers=2` | 最终定向 29 项通过，退出 0，含既有两项回归 |
| `pnpm --filter @solveflow/mobile build:web` | 最终产物构建退出 0；不代表 APK |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:56081 pnpm exec playwright test tests/mobile-e2e/verification-coverage.spec.ts tests/mobile-e2e/exam-materials.spec.ts tests/mobile-e2e/result-states.spec.ts` | 桌面/390 px 共 22 项通过，退出 0；包括新增的完整/缺项覆盖、刷新持久化与不重放模型请求四项 |
| `pnpm lint` | 退出 0；源码边界、当前文档、决策锚点与冻结档案检查通过 |
| `git diff --check` | 退出 0 |

全量测试首轮在受限沙箱出现回环 `listen EPERM` 和子进程 `spawnSync EPERM`：801 通过、102 失败、一个未处理错误，退出 1。沿用已授权的本机隔离测试权限后通过；没有修改超时或移除断言。最后的修正时序与指令澄清变更之后重新构建并执行全量回归，最终成绩如上。

浏览器使用本轮服务 PID 3773734、URL `http://127.0.0.1:56081`，隔离 IndexedDB 与假模型。完整小问核验显示通过，缺项显示无法确认，刷新后均保留两次请求与原答案，没有额外派发。结束后发送 SIGTERM，服务会话退出 0；本轮临时 pnpm PATH 包装已删除，证据文件保留。

## 未验证项与剩余风险

未执行真实付费题集、作文人工评分、多页照片读题准确率或供应商延迟复测，也未打包 APK、安装、真机或 PostgreSQL 全链路集成。已有 AP/化学/写作超时记录继续有效，本次没有替换原成绩。

coverage 是必要的格式/覆盖证据，模型仍可能漏读小问或错误报告已检查。增加预留可能使慢 Solver 更早失败；固定题集必须同时记录答案正确率、未回答/超时和误放行比例，不能仅统计 PASS 数量。旧客户端不保证读取新 coverage 字段，禁止降级覆盖。
