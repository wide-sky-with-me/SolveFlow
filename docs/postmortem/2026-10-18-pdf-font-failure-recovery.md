# PDF 字体失败状态与原地恢复验收

日期：2026-10-18。范围：R71，字体 HTTP 错误与损坏 WOFF2；候选完整 Web 构建，未采用、未部署。当前行为见[批次 PDF](../subsystems/batch-pdf.md)，前置证据见[字体等待与超时恢复](2026-10-18-pdf-font-resource-recovery.md)。

## 复现与修复

真实 Chrome 的 `FontFaceSet.ready` 正常兑现、集合状态为 loaded 时，所需 KaTeX_Main 字体仍可处于 error。R70 实现仅等待 Promise，继续布局、生成文件并保存 succeeded 记录。受控 HTTP 404 在整份导出期间持续生效；旧构建产出 27 页，其中 14 页 JPEG 与规范基准不同。错误文件保留在本轮运行目录，未作为合格产物交付。独立证据：`verify-font-failure-before-r71.py`、`r71-font-failure-before-verification.json`。

[建帧实现](../../apps/mobile/src/local/print-batch.web.ts)在资源就绪后检查失败字体，使用既有 ExportTaskFailure 返回可信的资源失败原因，在布局和后续绘制前退出。保留取消优先、20 秒资源期限、清理与迟到结果隔离；不改画质、几何、编码或模型调用。已加载和未使用的 unloaded 字体不误报。

[回归](../../apps/mobile/src/local/print-frame-pages.test.ts)新增 15 例，覆盖初始稀疏帧、初始完整帧、后续题页的失败/已加载/未使用字体，以及取消和到期优先。修复前校准后的回归为 3 失败、56 通过，修复后 59 通过。首次新增测试误把完整帧的三题布局计为一题，其两项期望错误已修正；首轮日志与校准后日志均保留，未改产品门槛。

## 原生方法与结果

同一 27 题缓存语料，桌面 1440×1000、CPU1、Chrome 154，串行独占回放。正式构建主入口由实际 HTML 提取，20 个静态文件逐一核验。主包 SHA-256 为 `02597152e0a962e03bc7ff621d3a8c70a32d8ba85d286cb1722f72f14f283d46`；KaTeX 原样式和原生 html2canvas SDK 与 R70 相同。

错误夹具仅把 CSS 中 20 个原字体 data URL 改为同源受控地址，不改字体定义或产品 JS。HTTP 场景返回 404；解码场景返回 200 与明确的无效字体字节，区别于先前同字节延迟夹具。错误持续覆盖首份导出的字体请求，终态确认后解除，再在同一浏览器上下文点击下载重试。

- 两种错误均在第三题实际字体等待处触发；已编码两页，尚未进入该题 SDK 克隆。原生 ready 兑现并记录 error 字体后，任务为 failed、文件与大小仓均空，未下载错误成品；界面显示“打印资源无法加载。”，下载按钮恢复可用。
- 两次原地重试各生成完整 27 页。独立检查存储/下载字节、27 页 JPEG、绘制流、RGBA、缓存不变和资源收尾，合计 54 页通过；模型、外部请求及页面异常均为零。工具为 `verify-font-errors-r71.py`，结果为 `r71-font-error-verification.json`。错误提示截图已人工查看。
- 同一当前完整构建另验原字节字体延迟、可信鼠标取消与真实 20 秒超时，后两者均成功重试；合计另外 81 页 JPEG/绘制流/RGBA 通过。工具为 `verify-font-normal-r71.py`，结果为 `r71-font-normal-verification.json`。两组共五份 PDF、135 页，均来自同一语料，不是多语料覆盖。

## 检查与边界

`pnpm exec vitest run`：164 文件、1721 例通过；定向四文件 197 例通过。`pnpm typecheck`、资产准备及完整 Expo Web 导出均退出 0。Node 24.21.0 与仓库要求 24.19.0 的既有警告保留。文档及差异检查、源码与证据冻结由本轮封存步骤记录，不复跑已经通过的渲染。

这里只证明当前候选在该语料、该浏览器下的字体故障处理与内容保真。初始帧字体错误的真实网络回放、其他资源组合、当前构建原始记录模式、不同错题目标及 20 份上限、移动端与其他浏览器、实体打印和一致流畅性收益仍待验。[题页物化提案](../../.agents/notes/proposed/storage/2026-10-18-pdf-frame-question-materialization.md)继续为 proposed。本轮无新的速度测量；保真不等于生产采用。原 3100 服务不替换。
