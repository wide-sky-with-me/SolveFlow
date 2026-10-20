# 打印帧按题接入候选验收

日期：2026-10-18。

范围：Linux、Chrome 154.0.8037.97、现有本地服务的私有路由覆盖；同一份既有27题照片批次，单份作答试卷。修正前候选来自TypeScript建帧函数的转换及两个下载调用点，不是新完整Expo构建。

结论：修正前私包通过保真、取消恢复及独立交叉计时；晚段输入等待改善，早段与总吞吐未形成一致收益。审阅后复现并修正取消/期限交接缺口，相关112项及完整1177项单元回归通过，移动端类型、边界/文档与隔离完整Expo构建退出0。新完整构建另通过首份及取消恢复，54页JPEG/绘制流与54组RGBA保持基准一致；当前版本的性能及更广验收仍待完成。候选保持proposed，未采用或部署，不代表生产流畅完成。

## 变更与版本边界

方案见[决策提案](../../.agents/notes/proposed/storage/2026-10-18-pdf-frame-question-materialization.md)。完整React来源和全部固定高度页壳保留，打印帧仅接入当前题的冻结正文；JPEG质量、页面别名及单份截止未另起协议。

修正前对照为 `r63-web-disposed-first-v1`，候选为 `r65-web-frame-pages-v1`。生成器从真实语法节点提取别名，仅改建帧函数及两个调用点，反向恢复原主包；其余静态文件和SDK字节不变。此前定位因Unicode转义、压缩逗号返回和局部变量重名失败，日志保留，修正后退出0。

完整源码边界修正晚于上述原生回放。修改前9份相关源码/测试复制到 `r65-native-source-v1/`，清单为 `r65-native-source-v1-manifest.json`；两个产品模块与生成元数据哈希一致。旧结果不可宣称代表当前源码，也不重新生成旧产物或刷新历史哈希。现有服务目录未替换。

## 修正前原生门禁

证据根目录为 `.runtime/pdf-production-2026-10-16/`；数量是重复回放同一批次，不是新增题库样本。

- 新帧回归在原实现上5失败、4通过。最初81项通过后类型检查发现替身getter缺少返回类型，补齐后退出0；追加集成回归后83项通过。
- 控制/候选合计12个上下文、20份完整PDF、30次可信取消；540页JPEG及绘制流、其中108组原始RGBA与既有基准一致。输入缓存前后不变，业务模型、外部请求和浏览器错误均为0；取消后完整重试成功。
- 原始像素场景观察到全部27个页壳保留，候选连接正文依次只有当前题，观察器最终断开。此观察未加入性能场景。
- `verify-frame-pages-r65-v2.py` 全部12上下文退出0，汇总 `r65-all-native-verification.log`。`verify-frame-static-r65.py` 在源码修正前退出0，验证20项静态文件/组、UTF-16三处正反向编辑及每个上下文的主包/SDK身份，见 `r65-static-verification.log`。

原始像素命令为 `inspect-frame-pages-r65.py --cpu 1 --capture --cycles 1`；新上下文首份用 `--scenario cold`，恢复用 `--scenario interactive --arrival-ms 1,150,700`，分别选择控制及候选。

## 修正前交叉计时

`inspect-frame-timing-r65.py --cpu 4 --cycles 2 --scenario interactive` 无RGBA回读、采样器、追踪或强制GC。晚段投递700/1100毫秒、早段投递1毫秒，各按控制、候选、候选、控制顺序独占串行执行。投递相对实际取消按钮边框获取，不承诺覆盖任意更早阶段。

每组8次成功、12次可信取消；40个工作窗口由独立脚本从原始结果重算，晚段24窗口另行复核，两个算术验证均退出0。

| 指标 | 控制 | 候选 |
| --- | --- | --- |
| 全部输入等待中位数 | 92.45 ms | 16.20 ms |
| 晚段输入等待中位数 | 152.90 ms | 31.60 ms |
| 全部输入等待最大值 | 324.60 ms | 211.00 ms |
| 早段输入等待中位数 | 6.40 ms | 6.60 ms |
| 成功导出耗时中位数 | 17,864.60 ms | 17,697.30 ms |
| 点击至界面观察终态最大值 | 428.00 ms | 438.20 ms |

样式/布局次数增加，不将改善解释为总工作量减少；单独某次晚段投递也有回退。结果支持继续验证交互方向，不等于所有时点都变快。CDP计数器包含窗口边界及驱动开销，不是函数级CPU归因；写入结束是IndexedDB事务完成，不是物理fsync，界面观察时间不是精确绘制时刻。

汇总为 `r65-frame-timing.json`、`r65-frame-timing-late.json`；独立复算为 `r65-frame-timing-analysis-verification.json` 及 `r65-frame-timing-analysis-verification-late.json`。

## 审阅、反例与修正

只读独立审阅未发现P1，提出两个P2交接缺口；按[资源交接决策](../../.agents/notes/implemented/storage/2026-10-18-pdf-resource-handoff.md)补失败回归后修正，不将静态推演直接当实跑结论。

- 资源helper末尾检查通过后、调用方续体前，以连续微任务取消/释放，原实现仍适配已释放文档。建帧及后页等待之后重新检查存活。
- 字体在20秒恰到/超过截止、timer尚未派发时正常或异常结算，原实现接纳成功或归到原错误。建帧/切页等待固定绝对截止，先取消、再期限、再原结果。
- 默认打印在建帧返回后、调用方续体前取消，或focus同步取消，原实现仍调用print。入口及focus后检查取消；完整默认正文、afterprint释放与API失败释放保留。
- 切页同步取消后返回拒绝，bounded入口先抛取消，原始激活Promise成为未处理拒绝。入口取消时也消费已启动work，正常结果仍走原交接。

`r66-frame-boundary-before.log` 为27项中12失败；补固定截止和调用方检查后该27项通过。默认打印追加两项在 `r66-print-entry-before.log` 失败。同步取消案例在 `r66-sync-activation-abort-before.log` 中16项断言通过但有1项未处理拒绝，整体退出1；保留此负证据。

最终针对性命令覆盖帧、范围、资源、下载、单页适配5个文件：`r66-frame-boundary-after-v3.log` 112项通过，`r66-mobile-typecheck-v3.log` 退出0。单份预算集成回归在首份JPEG写入后推进到45秒，验证后页仅剩15秒、恰到/超时成败、到期前与取消优先，且不产生部分成品。

最初把时钟推进放在绘制onProgress，先触发30秒绘制期限、尚未进入激活，导致7项夹具超时；日志 `r66-activation-deadline.log` 保留。改在首张JPEG写入后推进，`r66-activation-deadline-v2.log` 退出0，未放宽期限。首次追加测试的类型检查因exactOptionalPropertyTypes下给可选回调赋undefined失败，改用delete，最终检查通过。Node 24.21.0与仓库要求24.19.0的警告保留。

## 后续门禁

`pnpm exec vitest run --project unit --maxWorkers=2` 为115文件1177项通过，见 `r66-unit-all-v2.log`。`pnpm lint` 初次因当前说明超出2200单位失败，精简重复表述后 `r66-lint-v4.log` 退出0，未提高上限。共享包构建及资源准备退出0；`pnpm --filter @solveflow/mobile exec expo export --platform web --clear --max-workers 2 --output-dir <证据根>/r66-web-full-v1` 退出0，见 `r66-web-full-build-v1.log`。

构建仅写隔离目录，`r66-served-after-build-v2.json` 证明服务主包及HTML哈希前后不变。首次前检沿用私包入口文件名，在现有服务返回404，流程在检查前停止；改从实际HTML解析入口后核对原主包哈希。此为验证脚本定位问题，不是产品导出失败。

## 完整构建原生复测

首次回放在导出开始前读取私包专有的 `__r60SourceYield.stats` 失败，见 `r66-full-cold-v1.log`。完整构建没有该实验探针；第二版驱动明确记录null和不可用，不注入替身或伪造零计数。驱动只改三处可选读取及可用性字段；验证器只换完整产物身份、探针缺失断言和输出名，反向恢复验证通过，原PDF、RGBA、资源、缓存、VM和可信取消门禁保留。

`inspect-full-frame-r66-v2.py` 用相同CPU1/捕获/单周期参数顺序完成新上下文首份与取消恢复，恢复投递1/150/700毫秒；两个场景及 `verify-full-frame-r66-v2.py` 均退出0。新构建共两份完整PDF，54页JPEG/绘制流及54组RGBA与既有基准一致，3次可信取消及随后完整重试成功；输入缓存不变，业务模型、外部请求和浏览器错误为0，frame/画布及Blob/字节等待资源通过原门禁。结果为 `r66-full-frame-verification-v2.json`，原始日志为 `r66-full-{cold,recovery}-v2.log`。

新主包SHA为 `771c9409114b1849b0cbc5c5daa74446696ba3e1e6ad22fcd83a0641dfc83354`；SDK仍为 `4dbc509ee9025e6a33b89fb0da40a570454fb88a6ef51b3d4015f8f40570d8d3`，均由实际VM脚本复核。完整静态清单见 `r66-full-web-manifest.json`，派生证明见 `r66-full-replay-generation-v2.json`。本次有原始像素回读和帧观察，不是性能证据，也未借旧私包计时宣布当前完整构建更快。

## 剩余验收

更多语料、纯题/阅读、多份、受控冷/晚字体、真实物理打印、多浏览器及真机未由本次回放验收。默认打印新增的是源码级API替身回归，不宣称实体打印通过。后续性能对照须使用同份当前完整构建，只变逐题启用点，避免与旧版本的其他源码差异混算。源码、决策与复测记录将冻结到 `r66-source-final/`，其范围为PDF相关文件而非全仓镜像。
