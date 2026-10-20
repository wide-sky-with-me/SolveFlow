# PDF 原生浏览器时间线定位

日期：2026-10-18。

范围：本机 3100、Chrome 154.0.8037.97、CPU 四倍降速；沿用真实批次的隔离缓存、作答配置与 R60 透明对照。接续[建帧预尺寸负向实验](2026-10-18-pdf-frame-presize.md)，本轮只采集原生时间线，不新增或接入产品候选。

结论：独立场景重复出现首次输入长排队；窗口内可见显著 Layout、UpdateLayoutTree 与 PrePaint 工作。父子帧映射把两次 700ms 延时样本分别收窄到主页面、初始打印帧，二者当时均尚无嵌套绘制 iframe。frame 级证据仍不是来源 DOM 子树或某个 getter 的独立因果证明。产品、UI、构建及现有服务未变，整体生产流畅验收未完成。

## 方法与失败修正

从冻结的 `inspect-source-yield-r60.py` 派生诊断驱动。实际执行主包 SHA-256 为 `71f24a59585271287f7f1e78e826caed79b4dff5bebd84491990b32e1d473f14`；透明包装保持来源值及 Promise 身份，scheduled/resumed 均为零，不叠加来源让步或预尺寸候选。实际 SDK 仍为阶段版 `4dbc509ee9025e6a33b89fb0da40a570454fb88a6ef51b3d4015f8f40570d8d3`，保留 native Blob、原精度、取消与资源门禁。

通过原生 CDP `Tracing.start` 的 `ReturnAsStream` 采集 JSON，在 `Tracing.tracingComplete` 后读取并关闭 IO stream。分类为 `toplevel`、`devtools.timeline`、`v8`、`blink.user_timing`、`disabled-by-default-devtools.timeline`；关闭 CPU sampling、system tracing、截图采集和强制 GC，缓冲上限 128MiB、流上限 256MiB。只在现有开始/结束 evaluate 内增加 performance.mark，不在产品工作中新增 await 或通知门槛。

首轮 `integrated-r51-r62-native-timeline-a` 因把 getCategories 清单视为必要能力证明而停止，尚未导出。独立查询发现本机该实验性接口返回空列表；有界合成页面却在同一分类配置下实际记录到两条时间标记、30 次 Layout、30 次 UpdateLayoutTree，无丢失。因此修正的是诊断前检：清单仅供参考，真实 trace、marker、布局事件、线程与保真断言仍为硬门禁。原失败目录、初版驱动及 generation/log 均保留，随后以 a-v2 重跑。

两场串行运行；各自使用新浏览器上下文，三个独立控制器取消延时后恢复导出完整批次。A 为 700/1100/1800ms，B 为 80/350/700ms；输入仍由真实按钮 bbox 与可信 CDP 鼠标事件触发，没有用图片通知卡输入时机。采样期间未并发代理发起的构建、测试、诊断或子代理；普通主机服务仍在，不宣称整机隔离。只读子代理审查发生在两场采集结束后。

## 时钟、分类与角色

每个窗口以 performance.mark 的 entry.startTime 对齐原生 blink.user_timing 时间戳，而非假定两种时钟同原点。两场各自所有标记的 offset 展宽为 0.106/0.069ms；均落在唯一 CrRendererMain，起止差小于 1ms，B/E 配对无未闭合或孤立端点。原始 trace 分别为 91,225,679/79,885,642 字节、331,961/301,890 个事件，tracingComplete 均明确 dataLossOccurred=false。

分类裁剪到 event.timeStamp 至捕获监听器观测的区间。GC、布局、样式、HTML 解析、绘制、脚本/事件按此优先级排他计时；同类区间取并集，不叠加嵌套 JavaScript 与布局。另保留的 nested union 列不可相加。数值是 trace scope 的墙钟跨度，不是 CPU 样本、INP、物理帧率，也不用于与未采集时间线的实验比较延迟。绘制桶包含 PrePaint，不等同于栅格化耗时；未归类时间不证明空闲，也不自动算入脚本。

帧角色不是仅凭 about:blank 猜测：初态只有一个 browser frame；CommitLoad 的父子图得到唯一根，每个业务窗口的直接子帧数量与主 Document 探针记录、创建代次及固定打印 title 对应。打印帧下的嵌套帧按已执行 SDK 的 ownerDocument 创建路径归为绘制帧。两个完整成功窗口分别记录 27 个嵌套绘制帧；A 的 1100/1800ms 取消分别已创建 1/2 个，两个 700ms 取消则均为零。

初版映射器只寻找顶部 frame 的 URL metadata，而本次 trace 没有该记录，故主帧列表为空；保留初稿，改用上述父子图及独立探针对应后再出角色结论。没有新增浏览器采集或重写原始 trace。

## 输入窗口结果

以下均为诊断跨度，单位毫秒，不是优化前后对照：

| 场景 | 按下排队 | 布局 | 样式 | 绘制含 PrePaint | 脚本/事件 | 未归类 | click 排队 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A 700 | 137.0 | 83.980 | 25.939 | 20.555 | 2.232 | 4.294 | 439.8 |
| A 1100 | 123.2 | 15.699 | 4.183 | 12.653 | 2.236 | 87.487 | 130.4 |
| A 1800 | 28.3 | 2.758 | 5.293 | 1.334 | 17.291 | 1.203 | 34.5 |
| B 80 | 6.4 | 0 | 0 | 0.009 | 5.497 | 0.826 | 13.9 |
| B 350 | 8.4 | 0 | 0 | 0.028 | 7.273 | 1.099 | 14.8 |
| B 700 | 186.8 | 90.752 | 27.106 | 32.138 | 2.151 | 34.653 | 194.3 |

表中未列出的少量 HTML 解析仍计入完整排他结果，不把表内小计当作完全覆盖。A 700 的最大 Layout 在主页面，83.980ms、6188 dirty/7325 total layout objects；B 700 的 89.850ms Layout 在初始打印帧，6609 dirty/6609 total，另有主页面布局。两次 PrePaint 均发生在主页面。这些是 layout object 计数，不是 DOM 节点数或唯一来源子树大小。A 1100 的未归类部分较大，保留缺口，不由相邻长任务反推其内部 CPU 归属。

完整成功窗口分别为 19,344.4/20,190.9ms，最长原生 RunTask 为 310.083/374.684ms；两次均还存在明显布局、样式及脚本工作。不将这些带采集开销的吞吐或最大值作为新性能基线，也不宣称本轮提速。

## 验证、选择与后续

严格门禁核对两次恢复导出的 54 页 JPEG 及 PDF 绘制流、A4/分页/图片属性，均与同一真实校样一致；六次可信取消保持 cancelled、无文件或迟到下载，恢复下载与 IndexedDB 保存字节一致，原始/整理快照不变，资源与 browser frame 末态清理通过。新增 RGBA 样本为零；这是同一批次的重复验证，不是新题源或全模式容量复测。新增业务模型请求为零。

从实际分析器 AST 提取分类函数，另过八个合成区间用例：嵌套不重计、双边裁剪、未归类不伪装空闲、GC 与布局优先级、同类重叠并集、未知原生任务、零窗口及 HTML/绘制分桶。这只证明分析算法的这些边界，不替代真实浏览器或产品回归。

只读复核确认[来源根](../../apps/mobile/src/local/batch-export-root.web.tsx)已使用 startTransition；同一 fixed、800px、自动高来源外壳仅加 contain:layout，早在[离屏布局隔离](2026-10-17-pdf-layout-containment.md)交叉实验中未获收益。本轮不把该旧变量重新命名再测。layout paint 新增裁切语义，但 frame 级 Layout/PrePaint 不证明它能消除来源子树工作，不据此新增候选。现有[逐题忽略内容](../../apps/mobile/src/local/download-batch-pdfs.web.ts)也已在 ignoreElements 阶段保留空兄弟页几何，不把它误提为未实现方案。

下一步沿本次原生时钟与帧角色，在来源首段及初始打印帧定位样式/布局失效的触发节点或调用栈，再提出单变量改动。保留字体晚到、源内联字号、8pt/缩图门槛、取消优先及迟到资源边界；未归类区间继续单独处理。来源完整范围、长负载、浏览器/字体矩阵、真机与物理打印、现包部署及整体验收仍待完成。

证据根为 `.runtime/pdf-production-2026-10-16/`：`r62-diagnostic-plan.json`、`r62-tracing-support-filtered/`、两场 `integrated-r51-r62-native-timeline-*` 成功目录及原失败目录、`r62-timeline-verification.json`、`r62-timeline-analysis.json`、`r62-frame-map.json`、`r62-timeline-analysis-verification.json`。原 trace/执行包/本地成品留在忽略目录，不复制题图、原始长日志或浏览器 profile 到报告。生成、两场导出、加强 verifier、分析、帧映射及合成算法检查均退出 0；首轮前检退出 1 的记录独立保留。未运行新的产品构建、完整类型检查或应用回归，因为本轮没有产品源码变更。

协议参考：[Playwright CDPSession](https://playwright.dev/python/docs/api/class-cdpsession)、[Chromium Tracing 协议](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Tracing.pdl)。命令参数与冻结脚本、实际执行来源及原始输出一同归档。
