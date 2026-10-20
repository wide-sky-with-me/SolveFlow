# PDF 并发挂载验收

日期：2026-10-16。范围：本机现有 `http://127.0.0.1:3100/`，React 19.2.3 / Chrome 154，Web 下载路径。整体生产验收继续进行。

## 改动与边界

阅读、纯题、逐份作答不再以 `flushSync` 强制同步挂载。隐藏根使用 transition 和无 DOM 包装的提交/首轮效果确认；下载器在有界就绪后再建 frame。根错误中止整个派生信号，用户取消优先；逐份代次、失败脱敏、超时后的晚结果与异常清理均受控。原因和替代方案见[决策](../../.agents/notes/implemented/storage/2026-10-16-pdf-concurrent-mount.md)，当前语义见[批次 PDF](../subsystems/batch-pdf.md)。

容量、每题一页、字号、JPEG 质量、模型重试、完整保存后交付及存储重试复用成品的规则未变。快照仍全量校验，不增加基于可变对象身份的缓存。

## 单元与构建

- 新异步元素工厂用例在旧同步适配上复现 `root.querySelectorAll` 类型错误；补即时 rejection 消费后再次 RED，无未处理拒绝。该结果验证新增工厂能力，而非宣称旧同步调用方曾传入 Promise。
- 首批六文件 63 项通过；补齐工厂等待/期限/取消和三模式 runner 后，同六文件 78 项通过。`pnpm --filter @solveflow/mobile typecheck`、根 `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile build:web` 均退出 0。
- 根生命周期用例覆盖每份确认、晚旧确认、重叠调用、pending/兑现后取消、根错误在交付前后中止子信号、父信号不受根错误污染、监听释放和创建/卸载异常清理。下载器覆盖真实计时器、晚兑现/拒绝、同步取消同时返回 rejection、60 秒绘制预算起点不变；runner 断言纯题不传答案字段、作答逐份使用对应 copy、阅读保留历史图源。

## 真实批次前后复测

只读取 QA 来源并克隆浏览器状态，使用同一历史性能基准：27 题和旧 golden 整理缓存。本轮性能样本不是已修正图示的最终参考版。新增付费请求 0；正常/四倍 CPU 下取消，随后四倍 CPU 成功恢复单份 27 页 A4。三次新版各 1 次下载、0 页面错误；旧取消记录仍为 cancelled、无成品，来源/缓存哈希不变，存储与下载字节一致，容器/frame 清空。

探针 `.runtime/pdf-production-2026-10-16/inspect-interaction-r18.py` 新增隐藏根 append 到首个 frame 创建的窗口和 25ms 心跳计数；窗口包含导入、调度、render、提交和首轮效果，不是独占 React CPU。首次冷导入不用于证明 render 让出；暖缓存四倍 CPU 结果如下：

| 运行 | 取消轮挂载窗口 / 心跳 | 恢复轮挂载窗口 / 心跳 | 27 页恢复 | 最长任务 / 阻塞总量 |
| --- | --- | --- | --- | --- |
| 旧同步基线 | 452.4ms / 0 | 447.4ms / 0 | 16.8550s | 870ms / 7102ms |
| 并发首次 | 733.4ms / 18 | 746.7ms / 22 | 16.7045s | 776ms / 6529ms |
| 并发独立重复 | 886.6ms / 20 | 463.1ms / 14 | 16.6606s | 779ms / 6448ms |

结论是该挂载窗口获得了事件循环机会，而非更短：并发窗口存在调度与 passive 效果波动，首次明显变长；总导出时长差异不足以承诺稳定提速。正常取消到清理分别 77.80ms、74.78ms、196.84ms；四倍分别 331.51ms、295.23ms、285.76ms，均含自动化驱动/断言等待，不是 INP。最长任务仍在约 0.8 秒量级，尚非全链路无卡顿。

私有证据目录（同一父目录 `.runtime/pdf-production-2026-10-16/`）：`interaction-r21-before-concurrent/`、`interaction-r21-concurrent-mount/`、`interaction-r21-concurrent-repeat/`。旧入口主包 `index-3bd27f7ba409de380a43892fc99f763c.js`，新版 `index-e2678661dfb800a0f599d59dda949ef2.js`。三份 PDF 各 6565217 字节；SHA-256 依次为 `507dda7cd4d5366dedbba5027a586151a81ee6435c6f120127d2cc58f94b4ec2`、`010fc6466f780681b3ddf3d1cb4d8cb67e463cea68ec6163dce5e34a69eb3a94`、`c06c5919b1d3668a18478fb22ac37546506f9dbdc242675ce96d262496ed6e76`。文件整体哈希差异不能代表内容差异，逐页像素与实际 JPEG 另行比较。

## 浏览器与成品核对

新增用例区分模块加载取消与已开始 React 渲染的取消：受控首个题页 host 属性完成后排微任务，实际点击取消按钮；检查根存在但 main 未提交、尚未创建 frame、最终记录 cancelled、零下载/模型请求、源记录不变。此为可重复的调度边界验证，不是物理输入延迟测量。另注入持续的文档 mount 错误，验证静态提示可见/聚焦、容器释放、解除故障后原入口可重试，并验证无页面错误。

`compare-r21-pdfs.py` 对三次新版（含最终构建）与旧同步基线逐页比较：81 页 A4 的 144 DPI RGB 像素完全一致，实际显示 JPEG 字节 SHA-256 也完全一致。使用 `get_image_info(xrefs=True)` 核对每页唯一实际显示图像，未将共享资源清单当作已显示图像。最终结果在私有 `pixel-comparison-r21-final.json`。

首轮新增浏览器检查的 mount 错误/原入口重试在两种视口通过；挂载取消探针误命中弹窗预览，记录 `rootPresent=false`，两例失败。保留“根存在且未提交”的断言，改为沿宿主节点的 React fiber 回溯到准确容器；该测试依赖本轮 React 内部字段，升级时须复核，不进入产品代码。

后续审查另补两项 RED：清理异常覆盖原取消、同步 unmount 错误未进入静态分类。两项均如预期失败后修复，清理也再次让用户取消优先，未知卸载详情保持脱敏。最终六文件 80 项、根/mobile 类型检查与再次 Web 构建均退出 0；最终主包为 `index-33b11f362cfc990545b5af27b57b459c.js`。

最终构建再跑真实来源，`interaction-r21-final-cleanup/` 验收通过：新增模型/页面错误均 0，恢复 27 页 17.2376s；最长任务 812ms、阻塞总量 6531ms，挂载窗口 672.5ms、18 次心跳；正常/四倍取消到清理 196.32/315.32ms。成品仍为 6565217 字节，SHA-256 `36df33a27c62dabace415445dd3871e991db7abd2482f42a10ee3a3a271177a3`。这些波动再次说明未建立稳定提速或全链路流畅结论。

修正容器归属后的新增专项：`pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts --grep 'foreground mount|actually started' --workers=1`，桌面/移动视口 4 项通过（34.0s），输出在私有 `r21-new-browser-fixed/`；保留了根存在、main 未提交、零 frame 和终态取消断言。

扩大回归：`pnpm exec playwright test tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/background-exports.spec.ts --workers=1`，桌面/移动视口共 80 项通过（5.3min），输出 `r21-full-browser/`。另核对 mount 故障重试产生的桌面 ZIP：20 份、40 页 A4；两道题各自的 20 份实际显示 JPEG 均互异，排除整页复用上一份 DOM；不以图像互异代替答案正确性判断。证据 `copy-image-identity-r21.json`。移动反馈截图人工核对：错误提示在可见顶部，下载重试入口仍在底部，无横向截断。

工程初检发现子系统文档 2209/2200 单位和新决策缺 Markdown 源码反链，已压缩文案并补反链，保留长度门槛。修正后 `pnpm lint` 与 `git diff --check` 均退出 0。Node 24.21.0 与仓库固定 24.19.0 的警告仍存在，未变更环境。

## 遗留验收

React render 被拆分不等于切开单个 Markdown/KaTeX 函数、DOM commit/passive 测量、frame clone、Canvas 绘制和 PDF 序列化。后续仍需定位这些长任务，并完成真机、其他浏览器、低内存、长时负载及真实打印验证；本轮不更新 Mac 部署，不将移动视口当真机成绩。
