# PDF 取消入口与输入等待复核

日期：2026-10-18。

范围：沿用[绘制成本复核](2026-10-18-pdf-drawing-cost.md)的已存 27 题。分别验证准备入口的预取消优先级、真实构建的正常导出，以及可信输入等待的采样归属；三者不混作性能改善证据。

结论：修复了已取消仍读源、种子异常抢占取消原因的缺口；真实构建保持整批像素与取消恢复。主线程排队等待尚未解决，没有替换本地服务产物，整体生产流畅度仍未验收。

## 修复与复现

[准备函数](../../apps/mobile/src/local/prepare-batch-export.web.ts)原来先复制 seed 图片、遍历全批历史图，再进入逐记录取消检查。先补[失败测试](../../apps/mobile/src/local/prepare-batch-export.test.ts)：计数图源适配调用，并以抛错 getter 监测种子读取。原码出现 4 项失败、6 项通过；默认预取消仍调用一次图源适配，三种策略均由种子异常覆盖取消原因。

产品改动仅在函数入口增加 `signal.throwIfAborted()`，先于所有种子/来源读取，保留原取消原因对象。未给准备、公式、克隆或绘制增加调度点，没有改图像、质量、预算、缓存、保存或晚到结果逻辑。当前语义维护在[批次 PDF](../subsystems/batch-pdf.md)。

## 实际验证

运行日志与回放保存在 `.runtime/pdf-production-2026-10-16/`，入口为 `r57-verification.json`、`r57-input-attribution.json` 和 `r57-pre-cancel-build-proof.json`。

- 修复后 `pnpm exec vitest run` 定向覆盖 prepare-batch-export、prepare-paper-batch、run-batch-export、download-batch-pdfs、batch-pdf-resources、batch-pdf-render-scope：6 文件 85 项通过，退出 0。新增读取断言没有删掉模型、裁图与取消断言。
- `pnpm typecheck`、`pnpm --filter @solveflow/mobile typecheck` 均退出 0。`build:web --output-dir ../../.runtime/pdf-production-2026-10-16/r57-web-pre-cancel-v1` 成功真实 Expo 构建，没有写入服务目录。
- 从实际 Metro 产物提取准备模块工厂执行：saved/clean/paper 预取消均零读取，保留同一原因。移除入口语句并按词法符号统一 images/layouts 局部别名后，整个模块 AST 与前版相同；不是仅凭 TypeScript 转译夹具判断构建已生效。
- 新构建执行 CPU1 冷启动 RGBA 捕获及 CPU4 独占可信取消回放；两份 PDF 共 54 页逐页 A4、可见 JPEG 与绘制流一致，27 页 RGBA 与冻结基线成对一致，两次取消无成品并能继续成功。另一个采样诊断有 27 页、两次取消；总校验计数 81 页、4 次取消，未重复计作新构建样本。
- 实际 VM/分发字节与各自 staged 目录对应，原题和派生缓存哈希前后不变；模型、外部请求、页面错误均为零。沿用门禁确认 frame 断连、正常编码画布清零、通知收尾，不扩大成所有未编码对象或物理内存释放证明。

## 等待区间的证据与限制

诊断仍使用上轮尺寸前置隔离 SDK，而非新入口修复的正式构建；原生 CDP CPU 采样，没有 busy-loop 预热或强制 GC。700/2600 ms 到达点的观测等待为 407.6/33.4 ms，仅用于找区间，不估算原生延迟收益。

用 Profiler 起止前后页面时钟形成偏移边界，额外留 1 ms 量化余量；两次区间宽约 116.4/112.0 ms。首个等待的保守窗口内有 266 个样本，最近执行帧中 84 个属于 DisplayFormula 测宽，54 个属于 createBatchPrintFrame，另有 program/idle 等未细分项；已核对实际 VM 主包模块和源码。只能定位函数，尚未将建帧细分为克隆、样式或追加成本。第二等待短于时钟不确定范围，确定样本为零，不代表没有 CPU 占用。

静态审阅虽发现准备快路和整题适配的可分段边界，但本次证据不足以把输入长段归到这些循环。未加入盲目让步、首屏绘制暂停、字体隔离或跨页缓存；[此前首页](2026-10-17-pdf-firstpage-phase.md)与[字体反例](2026-10-18-pdf-drawing-cost.md)仍有效。

## 失败、复测与未验范围

首版产物证明因最小化器交换 images/layouts 的局部别名失败；保留日志后改为符号绑定级别的等价比较，属性、字面量与结构仍严格比较，实际工厂三策略复测通过。首次 lint 的源码边界通过，文档新增语义使长度达 2210/2200 单位而失败；精简措辞，不提高上限或改冻结记录。

本轮没有性能对照收益结论、新 UI 样式、完整副本/ZIP 组合、长期压力、其他浏览器或实体打印验收。新构建只隔离回放，原 3100 服务主包哈希保持不变。下一步细分公式测量与源 frame 的同步段；[项目状态](../project-status.md)继续保持流畅度未验收。
