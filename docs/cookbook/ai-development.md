# AI 接手与定位指南

目标是用少量可靠上下文完成一次变更。先读根规则、架构和目标目录规则，再沿下面的入口读实现与测试；不要一次加载全部旧 ADR、验收报告或生成文件。

## 从任务找入口

| 任务 | 先读的实现 | 能说明边界的测试 |
| --- | --- | --- |
| 请求次数、重复提交、按需内容、题目上下文 | [请求准备](../../packages/client/src/local-run-request.ts)、[引擎](../../packages/client/src/local-engine.ts) | [引擎回归](../../packages/client/src/local-engine.test.ts) |
| 取消、后台、结果保存失败 | [引擎](../../packages/client/src/local-engine.ts)、[运行时](../../apps/mobile/src/runtime.ts) | [存储故障](../../packages/client/src/storage-recovery.test.ts) |
| 批量答题/校验并发、失败题重试和暂停 | [批量队列](../../packages/client/src/local-batch.ts) | [批量回归](../../packages/client/src/local-batch.test.ts) |
| 历史、分卷、损坏恢复 | [仓库](../../packages/client/src/local-repository.ts)、[导入](../../packages/client/src/local-history-import.ts)、[导出](../../packages/client/src/local-history-export.ts) | [恢复与分卷](../../packages/client/src/local-history-import.test.ts) |
| 闪帧、切题、公式布局 | [分页器](../../apps/mobile/src/components/question-pager.tsx)、[绘制确认](../../apps/mobile/src/components/document-paint.ts) | [绘制回归](../../apps/mobile/src/components/document-paint.test.ts)、[真机操作](android-release.md) |
| 补图编辑、图片选择和答案快照 | [图片编辑](../../packages/client/src/local-image-selection.ts)、[请求准备](../../packages/client/src/local-run-request.ts) | [图片回归](../../packages/client/src/local-image-edit.test.ts) |
| 模型协议、非流式与响应限制 | [设备传输](../../packages/agent/src/pi/mobile.ts)、[JSON适配](../../packages/agent/src/pi/non-stream-response.ts) | [非流式回归](../../packages/agent/src/pi/mobile-non-stream.test.ts)、[传输回归](../../packages/agent/src/pi/mobile-transport.test.ts) |
| 考试、校验、超时和备用接手 | [业务编排](../../packages/agent/src/orchestration/solve.ts)、[考试契约](../../packages/contracts/src/exam.ts) | [考试回归](../../packages/agent/src/pi/mobile-exams.test.ts)、[备用回归](../../packages/agent/src/pi/mobile-backup.test.ts) |
| Web环境配置和固定角色代理 | [配置读取](../../scripts/web-env.mjs)、[代理](../../scripts/web-model-proxy.mjs) | [环境回归](../../tests/unit/web-env.test.ts)、[代理回归](../../tests/unit/web-model-proxy.test.ts) |
| 服务端任务、身份、SSE | [API](../../apps/api/src/app.ts)、[worker](../../apps/api/src/worker.ts) | [隔离集成](../../apps/api/src/app.integration.test.ts) |
| 文档规则与检查 | [检查器](../../scripts/check-project-docs.mjs)、[扫描策略](../../scripts/docs-policy.json) | [管理回归](../../scripts/test-project-docs.mjs) |
| 启动、页面状态、照片/提交/删除交互 | [入口](../../apps/mobile/src/app.tsx)、[工作区状态](../../apps/mobile/src/workspace/use-workspace-state.ts)、[操作](../../apps/mobile/src/workspace/use-workspace-actions.ts) | 浏览器 workspace/navigation 与相关故障回归 |

这是任务入口，不是全量 API 或决策索引。具体选择原因通过源码 `Decision:` 查找；新增功能先确认它走设备路径还是保留服务路径。

## 确认事实归属

- 最新用户授权决定目标；源码与实际测试说明当前状态。两者不一致时指出差异，不把旧文档或未完成规划当成现有能力。
- 字段、枚举和持久化格式读取 `packages/contracts`；备份容量、超时等实现常量沿所属源码核对。工具版本与命令读取根 `package.json`，应用版本读取 `apps/mobile/app.config.ts`。不要在文档、UI 或提示词中手抄另一份。
- 生成资源 [mobile-resources.ts](../../packages/agent/src/pi/mobile-resources.ts) 要改其学生源文件和 [清单生成器](../../scripts/prepare-mobile-agent.mjs)。`dist/`、`.generated/` 和原生生成工程不作默认编辑入口；原生能力先找 [插件目录](../../apps/mobile/plugins)。
- `.agents/notes`、AGENTS 和本指南仅用于开发。学生提示与方法资料在 `packages/agent/resources/`，两条阅读路径不能混在一起。

## 阅读和修改方式

先用 `rg -n '目标符号' packages/client/src` 一类限定目录的搜索找入口，读调用方、目标函数、失败测试，再扩展范围。隐藏决策目录用 `rg --hidden -n '关键词' .agents/notes`。不要广扫 `.env`、真实日志、题图或旧构建产物。

异步代码先确认“谁持锁、谁保存、什么时候释放、取消何时生效”。本地任务按 [生命周期](../subsystems/local-run-lifecycle.md) 阅读；判断正确性不能只看正常返回值。保留已经有的失败回归，不为拆函数编写只断言内部调用的测试。

让名称表达责任，一行保留一个主要副作用；把读者需要同时记住的大对象或嵌套流程拆成有意义的阶段。注释解释约束和原因，不逐行翻译语法。重构不要夹带文案、协议、错误码或任务时序变化，不为了缩短行数引入通用框架。

## 交接给下一位开发者

留下目标与授权、修改入口、保留的关键约束、实际验证命令/结果、未验证项和下一步即可。工作区有旧改动时说明本轮范围，不据全量 `git diff` 擅自回退。正在运行的服务记录自己的 PID/URL；临时源码快照用 `.snapshot` 后缀，避免测试发现器误收录。

长期原因写决策，当前行为改子系统文档，短期结果写复盘；不要把整段聊天变成永久规则。验收选择见 [测试规则](../testing.md)，文档格式见 [编写约定](documentation.md)，改动流程与检查范围见 [变更流程](change-management.md)。
