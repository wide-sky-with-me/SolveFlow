# 批次新增默认追加与菜单精简

日期：2026-10-27。范围：本地Web批次操作菜单，不含远程Mac部署。

用户要求移除“新增题图位置 / 追加到末尾 / 插入指定位置”预设。[批次工作区](../../apps/mobile/src/components/batch-workspace.tsx)删除菜单控件、位置状态及相册预设传递，连续拍摄与相册新增默认末尾追加；删除无调用方的旧控件。已有[导入工作台](../../apps/mobile/src/components/batch-import-workbench.tsx)继续支持点击插入和拖动，存储契约、事务、补图绑定和解题并发未变。

当前语义归[批次顺序](../subsystems/batch-order.md)和[批量导入](../subsystems/batch-import.md)。原有两种入口的插入用例改由工作台指定位置，并保留原题ID、答案、像素身份及保存顺序断言；新增菜单缺项与初始末尾位置断言。未新增镜像单元测试或运行无关核心套件。

## 验证

Node24.19.0 / pnpm11.7.0；独立`http://127.0.0.1:45191`禁用环境模型，浏览器使用合成JPEG、假模型及隔离IndexedDB。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` | 均退出0 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-append-default-2026-10-27/web` | 退出0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45191 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-import.spec.ts`，筛选既有插入、追加、单图工作台与单图拖动场景 | 桌面/手机共12项通过，退出0，1.2分钟 |
| `pnpm lint`、`pnpm docs:check` | 退出0，包含边界、长度与链接检查 |

日志、修改前快照及构建位于`.runtime/batch-append-default-2026-10-27/`。原生、真实模型及远程部署未验。

本机3100原进程261661保持运行，复制构建资源后原子替换入口，保留旧哈希资源和浏览器数据。首页及11项JS/CSS均200且哈希一致，无模型请求。独立45191服务核对PID与命令后停止。
