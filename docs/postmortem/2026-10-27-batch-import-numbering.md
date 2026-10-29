# 插入预览实时编号修复

日期：2026-10-27。范围：本地Web新增题图弹窗的编号与目标说明，不含远程Mac部署。

## 复现与修复

旧界面虽然重新排列格子，但已有记录仍显示原编号，新图只显示“新1”。向原第2张之前插入后，原第2/3张仍画成2/3，无法直观看到它们应顺延为3/4。新增浏览器断言在旧构建复现失败，退出1；原第2张格子找不到应有的3。

现在格子的大号数字统一显示保存后的预览编号；“新1”及发生变化的原编号作为小字辅助识别。选中新图时，摘要同时显示它的新编号和目标的新旧编号，例如“新1 → 第2张 · 目标：第3张（原第2张）”。点击目标的无障碍名称也使用当前显示编号，内部仍绑定稳定记录ID。

[编号投影](../../apps/mobile/src/batch-import-placement.ts)对应现有保存行为：指定插入时连续编号；普通末尾追加保留已有编号间隔，从最大编号后开始。反复改选、移除或回到末尾都会重新计算，不写原记录、不改原题Item号。保存与模型调用路径未变。

界面见[工作台](../../apps/mobile/src/components/batch-import-workbench.tsx)，当前语义见[批次顺序](../subsystems/batch-order.md)，此前窗口验收见[编号弹窗](2026-10-27-batch-import-dialog.md)。

## 验证

Node24.19.0 / pnpm11.7.0；独立45188服务禁用环境模型，Chrome使用色块JPEG与假模型。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run apps/mobile/src/batch-import-placement.test.ts --maxWorkers=2` | 1文件9项通过，退出0 |
| `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` | 退出0 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-import-numbering-2026-10-27/web` | 退出0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45188 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-import.spec.ts --grep workbench` | 最终6场景通过，退出0；不累计前一次同场景预跑 |
| `pnpm lint` | 退出0，包含边界与文档检查 |

浏览器覆盖桌面1440×1000、手机视口390×844和单图横屏844×390。验证两种新增入口的中部插入、再移到后方、恢复末尾、重新插入，断言所有格子数字及目标说明同步变化；确认保存后的编号与预览一致，旧题ID与session未变。

多图验证整组插到中部时新图占2/3/4、原2/3变5/6；分别插入不同位置后仍连续编号，停止并恢复不重复。无图片、光标唯一、取消零新增请求、深色模式和窗口边界断言保留；人工核对浅色手机与深色桌面截图。历史间隔语义由单元验证，本次未新增真实间隔批次浏览器夹具。

私有日志、截图、旧源码快照位于`.runtime/batch-import-numbering-2026-10-27/`。本次未付费调用模型、未重新运行未改动的其他核心套件、未做原生验收。验收后停止45188测试服务，保留本机3100；构建先复制哈希资源，再原子替换入口，不清理用户数据或旧资源。
