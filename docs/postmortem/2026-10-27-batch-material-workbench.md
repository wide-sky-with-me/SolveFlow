# 批量补图工作台与异步重答验收

日期：2026-10-27。范围：本地Web弹窗绑定、队列与材料保存；不含远程Mac部署。

## 改动与边界

批量补图采用与新增题图相同的居中弹窗，补图列表切换、题号网格多选和范围输入在同一工作台完成。同图可绑定多题，多图可绑定一题；最终确认前只是草稿。支持按需预览、裁剪、旋转、移除、键盘和深浅主题；标题和提交区固定，中部滚动。单题补图入口仍保持保存后手动重答。

队列允许在其他题求解或校验时提交。只读预检通过后，只取消接收者旧任务并等保存收尾；目标等待项暂保留，其他题继续派发。补图整体事务成功后，各目标替换为一份最新重答计划。旧答案和材料快照保留；取消旧任务时迟到的成功结果不能覆盖新答案。共享原有并发池，不增加无限并发。

预检失败不取消任务；写入失败不保存前缀补图、不启动新重答，原等待项恢复可派发。已经取消的旧任务不自动重放。真正的结果保存故障仍按既有全局存储阻塞处理。同图多题继续沿原对话逐题执行。

实现：[工作台](../../apps/mobile/src/components/batch-material-workbench.tsx)、[入口](../../apps/mobile/src/components/batch-materials.tsx)、[队列](../../packages/client/src/local-batch.ts)、[引擎](../../packages/client/src/local-engine.ts)、[仓库](../../packages/client/src/local-repository.ts)。当前行为归[子系统](../subsystems/batch-materials.md)，原因见[决定](../../.agents/notes/implemented/storage/2026-10-27-asynchronous-batch-materials.md)。此前新增题图拖动见[独立验收](2026-10-27-batch-import-drag.md)。

## 验证

Node24.19.0 / pnpm11.7.0。浏览器独立源`http://127.0.0.1:45190`禁用环境模型和模型网络，使用合成色块、隔离IndexedDB及假模型。桌面1440×1000和手机视口390×844，样式另含320×568和1920×1080，触屏仿真不代表原生验收。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run`：材料、队列、引擎、图片编辑、批次编辑/插入、补图契约及范围解析8文件，`--maxWorkers=2` | 127项通过，退出0 |
| `pnpm --filter @solveflow/client build`、`pnpm --filter @solveflow/mobile typecheck` | 退出0 |
| `pnpm exec tsc --noEmit` | 退出0 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-material-workbench-2026-10-27/web` | 退出0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45190 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-materials.spec.ts --grep 'binding workbench'` | 桌面/手机2项通过，退出0 |
| 同一URL完整运行`batch-materials.spec.ts`、`materials-multi.spec.ts`、`batch-import.spec.ts` | 92场景通过，退出0，5.5分钟 |
| 同一URL运行`batch-materials.spec.ts`、`batch-import.spec.ts`，`--grep 'batch-materials.spec\|stopping a prepared\|workbench drag previews'` | 最终准备链及卡片显示修改后34场景通过，退出0，1.7分钟；包含原场景，不重复累计 |
| `pnpm lint`、`pnpm docs:check` | 退出0，包含源码边界、文档长度和链接检查 |

离线覆盖无关活动题不中断、只取消接收者、旧结果迟到、同题更新期间拒绝冲突提交、无关新题继续入队、其他等待项继续、目标等待项只替换一次、坏归属不中断旧请求、事务失败恢复原等待项、重叠提交和核验等待者隔离。已有取消、停止、容量、归属、同图多题、部分保存恢复断言保留。

首轮新增异步单元在旧全局准入下4项失败；追加的无关新题准入用例先复现等待阻塞，拆分补图准备链后通过。新浏览器用例最初误用v2 schema读取v1合成记录，已改用对应schema。类型检查另修正测试UUID匹配类型和主题字段；未放宽生产契约或断言。截图复核后增高补图卡片，避免文件名受挤；选中题号文字对比度增加4.5下限断言，最终复测通过。

证据及修改前快照在`.runtime/batch-material-workbench-2026-10-27/`。未执行真实模型、原生真机或远程部署。

本机3100保持原进程261661；构建先复制资源，再原子替换入口，保留旧哈希文件与浏览器数据，不强制刷新当前页面。首页及11项JS/CSS均200且与构建哈希一致，未请求模型。独立45190测试服务在核对PID与命令后停止。
