# PDF 准入阶段让出与取消验收

日期：2026-10-16。目标：压缩连续启动阻塞，在独立阶段间处理取消，不改字节门槛、图片质量或公开输入验证。当前语义见[批次 PDF](../subsystems/batch-pdf.md)，原因与未采用方案见[决策](../../.agents/notes/implemented/storage/2026-10-16-pdf-admission-yield.md)。本轮仅本机 3100，未部署 Mac；不代表真机或全链路生产验收完成。

## 环境与方法

工作区 feat/batch-pdf-unified 原有大量未提交内容保留。Node 24.21.0、pnpm 11.7.0，固定 Node 24.19.0 的警告未更改。Chrome 154，桌面与移动视口非物理手机。复用原服务，未加依赖或新服务。

独立只读审计定位提交预检、接受副本元数据、runner 三次完整源校验；LocalExportTasks 只处理小元数据。当前构建 33b11f 的真实 27 题采样确认启动长任务 1007ms。CPU profile 首个 timeDelta 为 1488.344ms；原 0–1200ms 窗口为空，未当作无热点。改看 profile 1500–2700ms：submit inclusive 915ms；schema 正则 self 488ms；questionsForBatchQuestionPrint inclusive 565ms；精确计数 inclusive 153ms；submit self 195ms（含未展开原生段，不将其全部精确归给克隆）。采样有额外开销，不与未采样耗时直接作性能结论。

未采用跨 await 信任旧投影或对象身份缓存。新增真实消息任务边界，容量计数与克隆保持原子段，捕获后复核题数，前台准入接入已有取消 signal。独立初始化等待可取消，迟到失败被消费；任务接受后的生命周期仍归原队列。

## 复现与工程回归

新增[准入回归](../../apps/mobile/src/local/web-export-admission.test.ts)先在旧实现复现 10 项失败：没有调度边界，取消未阻断准入。私有日志 `r22-admission-red.log` 保留。首次类型检查发现测试数组索引未缩窄，补显式检查及可选索引；初版 107 项通过，再加入共享初始化取消/继续等待的集成回归后，最终 108 项通过。首次 lint 文档检查发现笔记节名未使用规定名称，改为“放弃的方案”“后果与限制”“验证”，未改标准。

命令：`pnpm exec vitest run apps/mobile/src/local/export-admission.test.ts apps/mobile/src/local/web-export-admission.test.ts apps/mobile/src/local/export-input-bytes.test.ts apps/mobile/src/local/batch-export-root.test.ts apps/mobile/src/local/batch-pdf-resources.test.ts apps/mobile/src/local/batch-pdf-render-scope.test.ts apps/mobile/src/local/batch-pdf-jpeg-alias.test.ts apps/mobile/src/local/download-batch-pdfs.test.ts apps/mobile/src/local/run-batch-export.test.ts`，108 项通过；`pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile build:web` 均退出 0。服务主 bundle 为 index-9334d303dd6e9d68375e94ef8a778b3d.js。

## 浏览器及真实成品

`pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts --grep 'cancels admission' --workers=1`：新增 8 项通过。随后运行 `pnpm exec playwright test tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/background-exports.spec.ts --workers=1`，88 项首跑通过，6.0 分钟，未删断言。包含帧/挂载/编码故障后重试、仅重试成品保存、20 份 ZIP、未回答纯题、取消与刷新不重放模型。新用例在四个消息边界实际点击取消；桌面/移动视口、4× CPU 限速下均无任务记录、文件、隐藏根/frame、模型或下载，双端口归零，源记录未变。已查看移动视口截图：取消反馈在设置列表上方，20 份设置保留，底部操作恢复。

干净独立浏览器回放：先运行 `inspect-interaction-r18.py --name interaction-r22-before-yield` 留同日旧构建基线；重建后分别使用 `--name interaction-r22-admission-yield` 和 `--name interaction-r22-admission-repeat`。每次均正常及 4× 降速取消 20 份，再降速成功导出 27 页；取消记录保留且无成品，完成后根/frame 清除，下载与入库字节一致，原题与整理缓存哈希不变。当前两次 PDF 都为 6,565,217 字节，各只下载一次；本轮产品模型真实请求为 0，累计仍为 67。

| 浏览器实测 | 同日旧构建 | 新构建首次 | 新构建复测 |
| --- | --- | --- | --- |
| 4× 取消样本，根创建前起始的长任务峰值 | 897ms | 345ms | 340ms |
| 同窗口根创建前心跳数 | 4 | 8 | 7 |
| 完整 27 页恢复导出 | 20.609s | 22.045s | 20.984s |
| 恢复导出全程最长任务 | 771ms | 709ms | 680ms |
| 恢复导出累计阻塞 | 8775ms | 10028ms | 8936ms |
| 4× 已开始绘制后的取消至清理 | 364.58ms | 330.06ms | 366.15ms |

结论只限启动连续峰值被拆开：总耗时、累计阻塞和绘制后取消未稳定改善。只保存最长十条长任务的窗口若未包含根创建前条目，只可记上界而非 0；首次恢复导出该峰值至多 418ms，复测为 381ms。分析脚本已修正这一处理，见私有 `interaction-comparison-r22-final.json`。

`compare-r22-pdfs.py` 对两个新 PDF 与同日基线做 144 DPI RGB、实际显示 JPEG 哈希对照：54 页尺寸、像素与 JPEG 全同；整份 PDF 哈希含元数据，不要求相同。私有 `pixel-comparison-r22.json` accepted=true；产物均在 `.runtime/pdf-production-2026-10-16/`，未复制真实题图或模型正文到仓库文档。

只读审阅未发现本次新增可确证缺陷；明确未关闭首次 queued 持久化期间 signal 到任务 ID 的既有交接区间。最终 `pnpm lint`、`git diff --check` 退出 0；文档检查为 204 current、66 decisions、126 source anchors、108 frozen，未放宽长度或冻结标准。

## 遗留核查

每次完整校验与计数/克隆仍同步；消息让出不保证逐次绘帧、固定优先级或降低总 CPU。Canvas、布局、序列化、低内存长时负载、物理设备和其它浏览器仍待验收。存储写入期间既有的入队交接边界未在本轮重设计。
