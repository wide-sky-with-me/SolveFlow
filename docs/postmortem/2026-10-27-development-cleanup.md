# 开发产物与代码文档整理

日期：2026-10-27。范围：本地仓库及已确认不用的临时Web构建，不含远程部署。

## 盘点与清理

开工时保护334份已有改动文件的哈希清单，并为本轮目标保存修改前源码。`.runtime/`约16GB，主要包含工具链、依赖存储、真实输入和验收资料；没有按目录名一概删除。

核对71条既有服务元数据，只有本机3100服务261661仍在本仓库运行；其实际根为`apps/mobile/dist`。保留该目录的全部旧哈希资源、当前最近已验证导出，以及配置、密钥、原图、识别结果、导出成品、浏览器快照、SDK、依赖缓存、全部日志/截图/源码快照和历史文档。

删除90份闲置Expo Web导出、1785个生成文件，合计702362332字节（约670MiB）；文件系统观察到可用空间增加710000640字节。清理前验证每个目录仅含允许的生成项，没有符号链接，文件数、总字节及入口SHA匹配清单。未删除整个运行目录或未提交文件。私有清单为`.runtime/development-cleanup-2026-10-27/cleanup-plan.json`，结果为同目录`cleanup-result.json`。

## 代码整理

- 从[批次页面](../../apps/mobile/src/components/batch-workspace.tsx)移除无调用的旧单图新增分支及导入，当前相册/连拍路径不变。
- 把固定过期时间、前台恢复、切页清理与资源释放提取到[提示hook](../../apps/mobile/src/components/use-expiring-notice.ts)，保留现有5秒及手动关闭行为。
- [补图工作台动作类型](../../apps/mobile/src/components/material-import.types.ts)由父子组件共用，减少重复签名。
- 已从界面退出的范围解析移至[测试辅助](../../tests/helpers/material-target-range.ts)，与E2E共用；原有10项范围断言全部保留，[应用模块](../../apps/mobile/src/batch-material-selection.ts)只保留实际使用的目标类型。

没有修改模型、并发、队列、持久化或产品交互。首次迁移辅助函数时使用了根测试目录没有的workspace别名，导致类型与范围单测不能解析；改为项目既有的测试源码相对导入，保留失败日志再复测。

## 文档整理

[文档入口](../README.md)补齐导入/排序、共享补图、ACT、快速PDF、导出任务及清理导航；[报告入口](README.md)按问题组织近期证据，压缩过长的旧PDF链接行。报告本身、原成绩和冻结资料保留。

新增[清理指南](../cookbook/development-cleanup.md)明确可重建产物和用户数据、工具链、证据的边界。快速PDF去掉重复描述，导入说明把过时“缩略图”改成当前编号工作台；旧补图决定补充范围解析仅用于测试的现状。

## 验证与交付

下列命令在仓库根目录执行，退出码均为0；日志保存在`.runtime/development-cleanup-2026-10-27/`。

| 实际检查 | 结果 |
| --- | --- |
| `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` | 移动端及根类型检查通过 |
| `pnpm exec vitest run apps/mobile/src/batch-material-selection.test.ts apps/mobile/src/batch-import-placement.test.ts apps/mobile/src/batch-import-drag.test.ts --maxWorkers=2` | 3个文件、25项通过，原10项范围断言未删 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/development-cleanup-2026-10-27/web` | Web构建通过 |
| Playwright功能配置运行`batch-materials.spec.ts`与`batch-import.spec.ts`的本轮筛选用例 | 20项通过，覆盖桌面/移动视口的导入、插入/拖动、补图绑定、独立重答与提示过期；完整命令见`verification.json` |
| `pnpm lint`、`pnpm docs:check`、目标文件`git diff --check` | 边界与文档检查通过；108份冻结文档保持原哈希 |

334份开工时已有改动文件中，本轮定向修改9份，其余325份哈希不变，无缺失或范围外改动。另有3份原本干净的文档更新及新增文件均按目标核对。

隔离测试使用临时45197服务，结束后停止服务并删除本轮生成的Web验证目录，保留日志。用户3100服务未重启，首页及引用的11份JS/CSS均返回200，与清理前哈希一致。本轮整理源码未替换其已部署静态资源。

未执行原生真机、完整全仓回归或真实模型测试；未调用付费模型，不清除用户浏览器数据，不更新远程Mac。日志、清理清单、源码保护和静态服务健康结果保留在本轮私有证据目录。
