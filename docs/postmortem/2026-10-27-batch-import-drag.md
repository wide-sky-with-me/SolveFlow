# 新增题图工作台拖动验收

日期：2026-10-27。范围：Web新增题图的鼠标、触屏拖动和本地构建；不含远程Mac。

## 行为与修复

待加入编号条和网格中新图均可拖动，新图之间可直接换序；开启“整组拖动”后按当前新图顺序移动全部输入。编号和目标随落点即时预览，松手确定位置；取消恢复此前草稿。长网格上下边缘自动滚动。原有点击定位、上下移动、移除及最终确认继续可用。已有题目相对顺序和ID不变，拖动不保存或触发模型。

实现见[指针适配](../../apps/mobile/src/components/batch-import-drag-surface.web.tsx)、[投影](../../apps/mobile/src/batch-import-drag.ts)、[工作台](../../apps/mobile/src/components/batch-import-workbench.tsx)和[确认入口](../../apps/mobile/src/components/batch-import.tsx)。运行语义归[批次顺序](../subsystems/batch-order.md)，取舍见[决策](../../.agents/notes/implemented/storage/2026-10-27-batch-import-pointer-drag.md)。原生保留点击适配，本次未增加原生拖动。

初轮完整拖动专项为6通过、2失败，退出1，保留日志。长列表鼠标跨格时，预览把已有记录移到指针下，落点从应有80变79；改为按可见格子在移除移动组后的基础序列定位。触屏阻止默认点击后，旧抑制状态吞掉下一次“整组拖动”按钮点击；改为在下一次主动按下时清除抑制。原断言未放宽，修复后8项通过。

## 验证

Node24.19.0 / pnpm11.7.0；测试URL为独立`http://127.0.0.1:45189`，服务禁用环境模型和模型网络。Chrome桌面1440×1000及手机视口390×844，触屏由CDP事件仿真，题图仅合成色块。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run apps/mobile/src/batch-import-drag.test.ts apps/mobile/src/batch-import-placement.test.ts --maxWorkers=2` | 2文件15项通过，退出0 |
| `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` | 均退出0 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-import-drag-2026-10-27/web` | 退出0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45189 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-import.spec.ts --grep 'workbench drag'` | 修复后8场景通过，退出0 |
| 同上完整运行，移除`--grep` | 40场景通过，退出0，3.8分钟；包含上述8场景，不重复累计 |
| `pnpm lint` | 退出0，包含源码边界与文档检查 |

专项验证单张落点、待导入图之间换序、整组移动、确认前数据库及模型请求数量不变、确认后保存顺序与色块身份一致。取消覆盖Esc不关闭弹窗、拖出网格、触控取消；80题网格验证自动滚到末尾、最终编号及松手后停止滚动。人工核对浅色桌面与手机整组截图。完整回归还覆盖停止/部分保存失败后恢复、重复加入防护、两种新增入口、默认末尾追加、深色及单图横屏布局。

私有证据在`.runtime/batch-import-drag-2026-10-27/`，包括旧源码快照、诊断失败、复测日志和截图。重复执行不累计为新场景。无付费模型调用、真实题图、原生真机验收或远程部署。

本机先复制29个构建文件中的资源，再原子替换入口，保留旧哈希资源与浏览器数据。原3100进程已停止，确认端口空闲后恢复为独立进程261661；静态健康检查首页及11项JS/CSS均200且与构建哈希一致，未请求模型。独立45189测试服务在核对PID及命令后停止，保留用户3100入口供手动测试。
