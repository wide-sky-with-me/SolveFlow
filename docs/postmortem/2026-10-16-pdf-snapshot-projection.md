# PDF 单次快照投影与取消复测

日期：2026-10-16。范围：Linux Chrome 154、既有本机 Web、客户端投影与独立渲染器；整体生产验收继续。

## 修正与边界

[前次启动采样](2026-10-16-pdf-interaction-budget.md)定位到重复图片验证。本次[组合投影](../../packages/client/src/batch-print-variants.ts)完整验证 unknown 快照一次，内部共享已解析值；旧公共投影仍各自验证。作答渲染从三次完整快照解析降至一次，纯题/阅读从两次降至一次，不代表整个生命周期仅验证一次。

[渲染器](../../apps/mobile/src/local/run-batch-export.web.tsx)仍先提取纯题、检查页数，再提取作答及检查副本；阅读模式不带单页题数门禁。已经取消时立即停止，不开始解析。未改图片 schema、容量、原图、缓存或异步准入冻结时点。原因与未采用方案见[决策](../../.agents/notes/implemented/storage/2026-10-16-export-snapshot-projection.md)。

[投影回归](../../packages/client/src/batch-print-projection.test.ts)先按旧链路组合复现两次/三次解析，单次解析断言失败，其余七项通过；拆分后通过。覆盖错误结构与优先级、未作答纯题、多小题、原输入及嵌套答案/数组修改隔离、同一输入修改后重新校验。[入口回归](../../apps/mobile/src/local/run-batch-export.test.ts)验证三种模式的投影/页数路由及已取消输入优先。独立只读审查未发现本轮生产代码的具体缺陷，未把历史工作区差异当作本轮改动。

## 真实回放

沿用前次只读 QA 批次与原始整理缓存，在克隆上下文各跑正常速度、CDP 四倍 CPU 降速下的 20 份实际出图取消，再以单份恢复。相同原题/缓存哈希保持不变；未重放数量验收中的十次四角编辑，不替代那份图像校样。新构建实际加载 `index-8079fe4284b49214605cc14057d85bd8.js`。

两次回放中，四倍降速的启动第二段长任务为 725/812ms，对照前版 1406/1213ms；正常速度取消窗口的最大长任务为 179/166ms。仅证明本样本中目标阻塞下降，不作为整体流畅、INP 或真机帧率结论。

正常速度取消至清理端到端为 62/69ms，四倍降速为 284/826ms；包含驱动和断言等待。较慢案例与当页长任务重叠，仍需区分绘制与驱动等待，不宣称取消延迟稳定改善。所有案例均已实际编码多页，随后终态 cancelled，无文件或下载、无打印框/隐藏渲染根。恢复导出结束后再次检查旧取消任务，仍保持取消且无文件，避免只查取消瞬间。

两次恢复均保存并下载 27 页 A4，分别约 17.99/16.85 秒；样本不足以证明整批吞吐稳定改善。每份 6,565,217 字节，下载与当次存储 SHA-256 一致；两份各与前版成品在 144DPI 比较，均 27/27 页像素相同。后一次 SHA-256 为 `d29b5518e4b06d8fc151d0dabec09835a9e72a465a92c5d9d8b4a6a218ea4de3`。跨次 PDF 元数据变化，不要求文件字节相同。

原始报告、截图、PDF、像素比较位于忽略目录 `.runtime/pdf-production-2026-10-16/interaction-r19-single-projection*`。复用同目录 `inspect-interaction-r18.py`，每次新目录；本次增加恢复后取消终态复查。产品模型新增 0，累计保持 67；页面异常 0。

## 检查与剩余工作

投影、既有作答/纯题及入口四个单测文件合计 26 项通过；客户端构建、根/移动端 TypeScript、Web 构建及上述回放/像素比较均退出 0。最终再次执行根 TypeScript、`pnpm lint`（含 `pnpm docs:check`）及 `git diff --check`，均退出 0。

浏览器初跑三文件 74 项：68 通过、6 失败，退出 1。失败全部位于旧[原始打印用例](../../tests/mobile-e2e/batch-pdf-export.spec.ts)：未显式选择阅读模式便要求打印可用，或试图提交已被输入草稿门禁拦住的非法裁框。修正为先选原始记录、断言更新禁用与内联错误，保留原图、打印内容、补图和角度断言。首次修正误加“未应用草稿须禁用打印”断言，两项仍失败；依据[图像语义](../subsystems/print-images.md)纠正为继续导出已保存图像。随后四项及最后两项分批通过，最后重跑退出 0；未放宽期限或修改产品门禁。完整记录保留在 `e2e-single-projection-r19`、`e2e-reading-print-r19`、`e2e-reading-print-drafts-r19` 私有目录，不抹除初始失败。

实际命令（仓库根目录）：

- `pnpm exec vitest run packages/client/src/batch-print-projection.test.ts packages/client/src/batch-print-variants.test.ts packages/client/src/batch-print-question-only.test.ts apps/mobile/src/local/run-batch-export.test.ts`：26 通过，退出 0。
- `pnpm --filter @solveflow/client build`、`pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm --filter @solveflow/mobile build:web`：均退出 0。
- `pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/batch-pdf-export.spec.ts --output=.runtime/pdf-production-2026-10-16/e2e-single-projection-r19`：初跑如上。
- `pnpm exec playwright test tests/mobile-e2e/batch-pdf-export.spec.ts --output=.runtime/pdf-production-2026-10-16/e2e-reading-print-r19`：4 通过、2 失败；最后以 `--grep 'batch PDF keeps ordered' --output=.runtime/pdf-production-2026-10-16/e2e-reading-print-drafts-r19` 复跑该文件：2 通过，退出 0。

浏览器新增[未作答阅读导出](../../tests/mobile-e2e/background-exports.spec.ts)，桌面和窄视口均实际后台生成、从记录下载并检查 PDF、源数据不变和零模型请求；合计覆盖 74 个浏览器场景。Node 24.21.0 与声明 24.19.0 的警告仍在，未改环境。

剩余为降速时的绘制长任务和偶发较慢取消。未验物理设备、实打印、Firefox/WebKit、低内存与长时负载；默认 Playwright 路径无后两种引擎。窄视口与 CPU 降速不代表真机；本次不重做源题内容质量验收。
