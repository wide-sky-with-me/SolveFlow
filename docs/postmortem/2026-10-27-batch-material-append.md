# 补图工作台继续添加验收

日期：2026-10-27。范围：本地Web连续选图和草稿保留，不含远程Mac部署。

## 问题与改动

用户在补图绑定弹窗发现图片没选够，但工作台只提供首次选择入口。新增“继续添加补图”，将本轮新图按文件名排序后接到当前列表末尾，保留旧图顺序、绑定、裁剪和旋转，自动选中第一张新图。新图未绑定时禁止保存；取消相册选择保留当前草稿。最终提交后，原批量入口仍可发起下一轮补图。

平台每次选择的原始ID都会从0开始，追加时分配递增草稿ID，删除不回收，同时移除对应绑定。所有新图加入同一个资源拥有集合，失败或离开后释放；新一轮超过剩余张数或累计500MiB原始字节时整轮拒绝，旧草稿保留。[选择元数据](../../apps/mobile/src/batch-photo-order.ts)增加仅内存的sourceBytes，Web和原生均沿用原限额，不修改存储或模型契约。

实现：[材料预览](../../apps/mobile/src/components/material-import.tsx)、[批量入口](../../apps/mobile/src/components/batch-materials.tsx)、[工作台](../../apps/mobile/src/components/batch-material-workbench.tsx)。当前行为见[批量补图](../subsystems/batch-materials.md)，取舍见[决定](../../.agents/notes/implemented/storage/2026-10-27-material-workbench-append.md)。单题入口没有开启新的继续选择按钮，沿用原流程。

## 验证

Node24.19.0 / pnpm11.7.0；独立`http://127.0.0.1:45192`禁用环境模型和真实模型网络，Chrome桌面/手机视口使用合成JPEG、隔离IndexedDB及假模型。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` | 均退出0 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-material-append-2026-10-27/web` | 退出0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45192 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-materials.spec.ts`，筛选连续追加、取消/超限及累计字节场景 | 6项通过，退出0 |
| 同源运行批量补图、单题多图及部分导入回归 | 66项通过，退出0，3.0分钟；包含专项6项，不重复累计 |
| `pnpm exec vitest run apps/mobile/src/batch-photo-order.test.ts apps/mobile/src/batch-material-selection.test.ts --maxWorkers=2` | 2文件14项通过，退出0 |
| `pnpm lint` | 退出0，包含边界和文档检查 |

专项覆盖裁剪旋转后追加、旧绑定保留、新图独立绑定、删除后再次追加不继承旧绑定、保存后再次提交、取消相册及数量超限不清空、累计字节超限只释放新图、关闭后临时URL归零。断言最终材料为300×588并共享给原接收者，重叠分配每个接收者只重答一次。

累计字节场景使用小JPEG，将隔离浏览器File.size仿真为6MiB；首轮50张、追加40张触发累计限制，未分配大型真实文件。虚拟列表的大样本只核对总数和可见行，不要求全部图片卡片同时挂载。

证据与原源码快照在`.runtime/batch-material-append-2026-10-27/`。原生仅完成共享源码类型检查，未做真机验收；未调用付费模型或部署远程。

本机3100原进程261661保持运行，先复制资源再原子替换入口，旧哈希资源和浏览器数据保留。首页与11项JS/CSS均200且与最新构建哈希一致，未请求模型。独立45192测试服务在核对PID及命令后停止。
