# PDF 清理异常后的失败结算与重试

日期：2026-10-19。范围：Web、Chrome154、既有27题准备缓存、单份作答试卷。结论：受控清理故障在旧完整构建中复现等待/生成槽挂起；修复后失败正确结算，同窗重新生成成功。不是自然线上故障或流畅性根因声明；未部署。

## 原因与修正

本轮原定研究首段交互长尾；只读审查发现[下载器](../../apps/mobile/src/local/download-batch-pdfs.web.ts)的 bounded 先锁定终态、清timer/abort监听，再 cleanup、reject。清理允许抛错，因而可跳过 reject；后续取消也救不回该 Promise，runner 不退栈，生成槽不释放。原绘制清理还可能在租约异常后漏掉打印帧。

修复将清理异常收进 cause，再按原主要原因结算；已知超时保留 ExportTaskFailure 分类，不提升第三方错误的公开信任。绘制失效先关闭租约活性，再独立尝试全部清理，保留多个异常及 undefined。画质、页别名、截止、调度、模型与缓存协议不变。局部补充关系与取舍见[决策](../../.agents/notes/implemented/storage/2026-10-19-pdf-cleanup-settlement.md)。

## 回归与构建

证据根 `.runtime/pdf-production-2026-10-16/`。`r76-cleanup-red.log`：真实下载模块/API替身先有3失败、57通过，清理异常打断绘制、编码和读取的定时器结算。首次绿色复测仍1失败、75通过：替身把 onclone 前失败所对应的未交付画布当成了已交付，零尺寸断言不适用该时序。保留原日志，改为真实的克隆完成后等待绘制，并重置每次模拟画布；晚画布清零断言未删。

最终新增8项覆盖清理抛错、两清理均抛错/undefined、取消优先、迟到结果隔离、重新生成及未知错误不提升分类。`pnpm exec vitest run apps/mobile/src/local/batch-pdf-resources.test.ts apps/mobile/src/local/batch-pdf-render-scope.test.ts --maxWorkers=2`：81项通过，`r76-cleanup-green-v2.log`，退出0。`pnpm exec vitest run --maxWorkers=2`：164文件/1732项通过、39.97秒，移动端 `typecheck` 退出0。Node24.21.0与指定24.19.0的警告保留。

隔离完整Expo导出 `r76-web-full-v1`，未覆盖原站点：`expo export --platform web --output-dir .../r76-web-full-v1 --max-workers 2 --clear`。20项静态文件，主包SHA `c848e7cd1542684ca84b96e254c09b4d68386697acb4a758189b46b5434c3105`；SDK仍为 `4dbc509ee9025e6a33b89fb0da40a570454fb88a6ef51b3d4015f8f40570d8d3`。清单见 `r76-full-web-manifest.json`。

## 受控原生故障

驱动 `inspect-cleanup-r76.py` 由已冻结驱动仅派生单份设置与故障流程，前缀逆变换逐字节通过。保留真实缓存、路由/CSP、原生绘制、JPEG .94和编码结果；只扣留首个原生JPEG回调，并在该打印帧实际remove后抛一次清理异常，不缩短任何产品期限。参数为 `--mode integrated --scenario cold --cpu 1 --capture --cycles 1 --copies 1`，旧构建另加 `--expect-hang`。两个新上下文串行，未与构建/测试重叠。

旧对照 `integrated-r51-r76-cleanup-control-v1` 运行未改的R74完整构建：30秒资源截止触发清理异常后记录仍running；真实点击取消后记录cancelled，下一任务在释放晚JPEG回调前后仍queued，各观察1秒。无文件/下载，预期浏览器异常仅该注入值；不将此对照标为产品验收成功。

当前 `integrated-r51-r76-cleanup-current-v1`：同故障下首任务failed，公开原因仍为“PDF 资源处理超时，请重试。”，没有文件；晚回调释放不改终态。错误条可见、下载按钮恢复，原位点击后新任务成功生成27页，下载与本地存储字节/哈希一致。两上下文退出0并关闭；模型调用、外联及当前页面错误为0。故障来自受控注入，未证明原生平台自然发生同样的清理异常。

## 独立核验与边界

独立核验v2退出0：重试成品27页的JPEG、绘制流、整页RGBA及浏览器原始RGBA均与冻结首份一致；失败与晚结果、存储、资源及实际VM门禁通过。下载源码四处反向替换逐字节恢复上轮源文件，其余正常路径未变。首次核验把ZIP条目显示名当成本地证据文件名而退出1；保留初版及 `r76-cleanup-verification.log`，v2只改为已核对的本地首份路径，不改任何保真门禁，也不重复浏览器回放。

本轮没有改UI样式、源文档片段归属或既有未采用性能候选；错误交互恢复来自结算修复。没有新增20份当前构建、更多语料、软键盘/真机或跨浏览器验收；[上轮首次上限](2026-10-19-pdf-twenty-copy-cold.md)只代表当时R74构建。保真插桩不作延迟/物理内存结论，逐题提案仍保留proposed，总体生产目标继续执行。文档检查先后因2210/2205超过2200单位退出1；精简原段、收束决策链接并澄清逐份挂载后复验，未放宽阈值。最终文档/差异检查及不可变父级复核随 `r76-final-integrity.json` 封存。
