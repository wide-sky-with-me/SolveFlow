# 整体计时与历史样式验收

日期：2026-10-09。范围：整体手动计时、历史卡片与菜单高亮。

秒表移到工作区顶部，只挂载一次；跨题目、批次和页面共用整体累计，手动开始、停止、续计和重置，刷新保留。整体状态独立保存，不依赖题目存在；清空历史保留整体计时，旧逐题值保留但不合并。历史改为圆角卡片，序号、科目/答题状态、题干和时间分层；保留数学渲染、分页、左滑收藏和删除确认。菜单反馈增加圆角与卡片内边距，悬停改为轻背景。

## 验证

首次新增计时回归42项中1失败：清空历史删除了整体键，累计值由12345变为0；已修复，原始日志保留在忽略目录`.runtime/overall-timer-2026-10-09/before.log`。

检查及结果（退出码均为0）：

| 检查 | 实际结果 |
| --- | --- |
| `pnpm typecheck` | 全工作区与移动端类型检查通过 |
| `pnpm exec vitest run packages/client/src/local-engine.test.ts packages/client/src/history-payload.test.ts packages/client/src/history.test.ts packages/client/src/history-export.test.ts packages/client/src/history-import.test.ts` | 5文件103项通过；覆盖整体持久化、清空历史保留、显式重置和坏计时保护，以及摘要/备份兼容 |
| `pnpm lint` | 通过，包含文档检查 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/overall-timer-2026-10-09/web` | Web导出成功 |
| `pnpm exec playwright test`（6文件） | 首轮32项中28通过、4失败；更新改版后的定位与手势起点，相关3文件14项全部复测通过；最终覆盖32项不同用例，不将重复运行累加 |

浏览器文件为overall-stopwatch、history-management、history-rendering、desktop-layout、exam-flow及style-controls。覆盖手动计时/跨页面/刷新/重置、320–1920宽度与深浅主题、顶部控件不重叠、菜单圆角和内边距；另保留历史分页、纵向滚动、左滑收藏/删除确认、公式及文档超时降级验证。

首次浏览器失败均为旧测试定位：两项仍寻找“序号1”及旧时间节点；另两项从右上角新操作按钮发起左滑，组件按原交互规则忽略按钮上的滑动。已改为可访问序号标记/独立时间节点及卡片正文手势起点，未删除或降低收藏、分页和删除断言。原始与复测日志分别为忽略目录下browser.log、browser-final.log，保留失败截图。

测试使用隔离浏览器和合成题目，不访问用户历史或调用真实模型；浏览器移动视口不代表Android/iOS真机。尚未打包或安装本轮APK，未执行iOS原生构建。现有APK仍为前轮产物，未包含本轮整体计时和样式变化。

## 本地Web交付

已人工核对1440宽度的深浅色历史列表，合成4条记录且模型POST为0；截图在本轮忽略目录history-wide-light.png与history-wide-dark.png。已更新正在运行的localhost:3100静态资源，保留旧哈希资源、最后替换index以保护尚未刷新的页面。隔离浏览器实测HTTP200，整体计时开始/停止/刷新恢复和菜单圆角高亮通过，模型POST为0；证据为live-smoke.log与live-profile.png。本轮随机端口测试服务已关闭，保留用户3100服务。
