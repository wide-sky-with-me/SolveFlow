# PDF 异步编码与取消复测

日期：2026-10-16。范围：本机 Web 3100；生产验收继续，未更新 Mac。

## 本轮改动

[下载器](../../apps/mobile/src/local/download-batch-pdfs.web.ts)逐页改用 JPEG Blob 和字节输入，不再同步创建 data URI 再解码 base64；质量、几何、容量计数与门禁不变。编码/读取分别受资源与单份剩余期限约束，异步之后先核对取消，保留 finally 清理。静态审查发现 jsPDF 4.2.1 的 typed-array 自动别名只哈希前半字节，已以单份内逐页唯一标识避开错页复用；同份重复位图不再自动去重，可能增加文件大小。取舍见[决策](../../.agents/notes/implemented/storage/2026-10-16-pdf-async-jpeg.md)。

[资源测试](../../apps/mobile/src/local/batch-pdf-resources.test.ts)新增精确非零字节/原参数、空结果、格式异常、编码/读取失败、两阶段取消/超时、微任务交错和迟到回调；[范围测试](../../apps/mobile/src/local/batch-pdf-render-scope.test.ts)锁定独立页标识，[实库测试](../../apps/mobile/src/local/batch-pdf-jpeg-alias.test.ts)核对两个尾部不同的合成 JPEG 头产生独立图片对象。后者只验证解析/缓存，不是真实 JPEG 解码。

[浏览器测试](../../tests/mobile-e2e/background-exports.spec.ts)新增编码失败后原位反馈、保留设置并重试成功；保存重试改观察实际 toBlob 调用且要求初次计数大于零，避免旧 toDataURL 观测点失明。桌面和移动视口均验证错误完整可见、焦点定位与资源释放，人工读取窄屏截图，提示与底部重试入口未被长副本列表遮挡。

## 检查记录

- 新增编码用例在旧实现先失败：预期 JPEG/.94 请求，实际为空；退出 1，未弱化断言。
- 初次相关单元 40 项通过；加实库回归后 41 项通过，最后补齐精确字节与读取期限后 46 项通过。根与 mobile 类型检查、Web 构建退出 0。
- 根类型检查后，三个受影响浏览器文件单轮 76 项全部通过，4.9 分钟、单 worker；包含桌面/移动编码失败重试、保存重试不重绘、原始记录、纯题、作答、多份 ZIP、数量草稿、取消与刷新恢复。
- 首次 lint 的源码边界通过，文档检查因新笔记格式及子系统 2203/2200 单位失败。按现有模板补齐元信息/章节并精简当前文档，门槛未调整；最终 lint 与 diff 检查退出 0，文档计数为 200 当前页、64 决策、124 源码锚点、108 冻结档案。

实际命令：`pnpm exec vitest run` 指定上述四个单元文件；`pnpm --filter @solveflow/mobile typecheck`；`pnpm exec tsc --noEmit`；`pnpm --filter @solveflow/mobile build:web`；`pnpm exec playwright test` 指定 background-exports、batch-pdf-variants、batch-pdf-export 三个文件，输出在 `.runtime/pdf-production-2026-10-16/e2e-async-jpeg-r20`。Node 24.21.0 与仓库固定 24.19.0、终端颜色变量的已有警告仍在，本轮未改环境。

## 真实批次与交互

保留原 QA profile，只读提取后在副本回放同一 27 题与准备缓存。基线为本轮改动前 `interaction-r20-draw-profile`；改后两轮为 `interaction-r20-async-jpeg` 与 `interaction-r20-async-jpeg-repeat`，均在 `.runtime/pdf-production-2026-10-16/`。现有入口刷新后加载 `index-3bd27f7ba409de380a43892fc99f763c.js`，未另开服务。

每轮先在正常与四倍 CPU 降速下实际开始多页绘制，再取消 20 份任务；两条记录和精确键对应文件在随后成功恢复导出后仍保持取消/不存在，无迟到下载；随后四倍降速完整下载 27 页 A4。各轮下载一次、入库与下载字节哈希一致，无隐藏根/iframe、页面异常或产品模型请求，原题及准备缓存哈希保持不变。累计产品调用仍为 67，本轮新增 0。

| 完整恢复导出 | 改前采样 | 改后首轮 | 改后独立复测 |
| --- | --- | --- | --- |
| 耗时 | 19.47 秒 | 18.61 秒 | 19.14 秒 |
| JPEG API 同步调用最长 | 134.1 ms | 44.2 ms | 55.5 ms |
| JPEG API 同步调用 P95 | 130.3 ms | 43.3 ms | 37.9 ms |
| 异步回调最长等待 | 不适用 | 130.8 ms | 422.9 ms |
| 全阶段最长任务 | 915 ms | 961 ms | 807 ms |

同步调用与异步回调分开记录：回调时间包含排队/编码等待，不是主线程阻塞；同步调用仍有 55.5 ms 异常值。首轮启动时与定向类型检查有短暂重叠，独立复测未并行运行构建/测试。基线 CPU profile 截窗还包含准入/挂载/自动化查询，不宜都归为绘制。编码同步占用改善，不据此宣称整体稳定提速或消除卡顿。

请求取消至清理断言结束：首轮正常 81.7 ms、四倍 341.8 ms；独立复测正常 84.1 ms、四倍 295.2 ms。基线分别 113.7/419.9 ms，上一轮四倍曾出现 825.6 ms；这些时长包含自动化通信与断言等待，不是 INP 或真机交互指标。

## 成品一致性

两轮成品均为 6,565,217 字节，SHA-256 分别为 `df7c366a7323ba7b4151014baeb7c4bc45e1b68dafe2a81a298f41c44e78f1bf`、`85af647b39040e64e57d0be9a24fba66cce4eecbaf8e1d727037d34f6466d258`。不以文件级哈希不同或长度相同推定视觉差异/一致。

首次字节探针错误地把共享资源列表当作逐页使用列表：get_images 返回 27 个共享引用，而首张实际展示图只有 1 个；保持每页实际展示一图的断言，改用 get_image_info 的 xref 定位后复测。最终两轮共 54 页在 144 DPI 逐页像素完全一致，嵌入 JPEG 字节的 SHA-256 亦逐页一致，每页实际展示一图；探针退出 0。脚本为 `.runtime/pdf-production-2026-10-16/compare-r20-pdfs.py`，结果在同目录 `pixel-comparison-r20.json`。

## 剩余范围

继续优化整份同步挂载、DOM 布局/绘制及 PDF 序列化；CPU 降速下仍有长任务，未完成生产级流畅验收。跨浏览器、物理设备、低内存、真机打印与长时运行未补验。底层编码/读取没有直接中断接口，软期限阻断迟到产物而非保证终止浏览器工作。

本轮性能/像素夹具沿用前两轮 golden 准备缓存，不是第 17 轮修正几何后的准备结果；不替代[实图与大份数验收](2026-10-16-pdf-copy-quantities.md)，不宣称原图缺失文字已补全或各题内容已完全准确。
