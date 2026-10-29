# 跨批次隔离与任务总览验收

日期：2026-10-28。范围：本地队列、历史/批次PDF入口、任务总览弹窗；Linux、Node 24.19.0、pnpm 11.7.0，浏览器使用合成题图、独立IndexedDB和假模型，未连接真实模型。

## 变更与处理

原队列启动失败会清空其他批次等待项，范围停止使用全局停止标记，另一批次也会禁用已完成批次的PDF入口。修复后范围停止和启动错误按批次隔离，跨批次等待容量独立于已接受图片/核验输入上限。总览合并摘要与内存队列阶段，通过更多菜单执行单批操作；继续清单在读取元数据期间收到停止也不再派发。运行语义见[批量任务](../subsystems/batch-tasks.md)，取舍见[决策](../../.agents/notes/implemented/architecture/2026-10-28-multi-batch-task-isolation.md)。

## 验证结果

本次私有日志、源码基线、截图和生成PDF保存在`.runtime/multi-batch-tasks-2026-10-28/`，不提交原图、配置或模型正文。

- 修复前，`pnpm exec vitest run packages/client/src/local-batch-isolation.test.ts --maxWorkers=1`退出1，4例分别复现启动失败清空他批、停止拒绝他批准入、缺少快照、超过单批容量拒绝等待。
- `pnpm exec vitest run packages/client/src/local-batch-isolation.test.ts packages/client/src/local-batch.test.ts packages/client/src/local-batch-materials.test.ts packages/client/src/storage-recovery.test.ts apps/mobile/src/batch-task-summary.test.ts --maxWorkers=1`退出0，53例通过；另运行`apps/mobile/src/batch-task-actions.test.ts`退出0，2例通过。合计55个不同场景，覆盖120张跨批等待、已接受上限、存储保护和停止期间清单读取。
- 首次兼容回归有1例失败：旧测试断言另一批第101张在等待入口被拒绝。按新行为改为等待成功，同时保留引擎拒绝超出已接受容量和原记录无新run断言；最终53例全部通过，未放宽执行上限。
- `pnpm build:shared`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`及隔离Web导出均退出0。首次移动类型检查发现误用不存在的主题颜色字段，修正后通过。
- 专用回环服务运行`tests/mobile-e2e/batch-tasks.spec.ts`，桌面和窄屏共4个场景通过：独立导出/停止/续跑，以及深色短窗口总览。B批答题时A批实际下载合法PDF；停止B后C继续，B仅首题取消，其余仍未启动。首次2例未发出假模型请求，原因是夹具重载后Web内存密钥清除；按实际设置规则重新配置后这2例通过。首次成绩保留，不重复累计。

- 最终构建上，`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45228 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-tasks.spec.ts tests/mobile-e2e/batch-management.spec.ts tests/mobile-e2e/batch-solving.spec.ts tests/mobile-e2e/batch-materials.spec.ts --grep "batch task overview|task overview stays|clearing single|second batch edit|discarding a saved|capture|camera gallery|finishing a new batch|reuses assigned images|binding workbench replaces"`退出0，26例通过；覆盖批次编辑/删除、连续拍摄、保存重试与异步补图。上述4个总览场景包含在26例内，不重复累计。

- 补全批次页清单读取异常反馈后，最终产物重新运行总览4例，退出0；不累计为新场景。相关类型检查、Web构建通过。文档检查曾因状态页/渲染页超长失败，精简重复表述，未提高长度门槛。

- `pnpm lint`最终退出0，398份当前文档、120份决策、200个源码锚点和108份冻结文档检查通过；`git diff --check`退出0。本机3100原子更新入口成功，页面及11个JS/CSS资源均200且哈希吻合，79个旧资源保持原字节，服务未重启、配置和浏览器数据未改动，远程Mac未部署。

## 未验证项与剩余风险

所有模型响应均为假供应商，不证明ACT识别或答案准确率。未执行Android/iOS原生、供应商限流、全仓测试或远程Mac更新。Web仍需保持页面打开，未新增持久后台服务；批次共享模型并发、网络和存储锁，存储故障仍全局阻止派发。
