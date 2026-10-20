# PDF 执行发布取消与终态补存复验

日期：2026-10-17。范围：本机 `http://127.0.0.1:3100/`，分支 `feat/batch-pdf-unified`。本轮修复派发取消与终态补存，最终构建/回归和27页保真通过；绘制长任务仍待优化。未提交、推送或同步 Mac。

## 问题与修复

已接受任务把 running 保存并发布后，订阅者可同步或通过微任务取消。旧实现仍建立执行计时器并调用持有已取消信号的 runner。修复在实际派发前检查执行控制器，沿原串行锁等待取消收尾，在 finally 才释放 active。不把准入 signal 绑定到接受后的生命周期，不改变单槽/FIFO、保存故障中断等待项和超时规则。

只读复核还发现既有终态身份漂移：cancelled 或超时 failed 写入成功、回执随后报错，重应用停止意图会重算 finishedAt。推进时钟时，持久对象与 pending 对象不同，严格终态门禁阻止补存。修复只在目标终态不匹配时转换，保留相同终态的完成时间及完整身份；不放宽冲突保护，不重放准备或绘制。原因、替代方案与代价见[决策](../../.agents/notes/implemented/storage/2026-10-17-pdf-dispatch-cancellation.md)，当前行为见[批次 PDF](../subsystems/batch-pdf.md)。

## 失败证据

所有私有产物位于 `.runtime/pdf-production-2026-10-16/`，保留原失败日志。

- 旧核心新增发布回归：`pnpm exec vitest run packages/client/src/local-export-tasks.test.ts`，8 failed / 51 passed，退出1；`r24-dispatch-red.log`。同步/微任务、补写故障、排队晋升均观察到已取消 runner 被调用一次。
- 更新源码但尚未重建客户端包时，真实队列 Web 集成为4 failed / 12 passed，退出1；`r24-web-red.log`。准备 spy 收到已取消执行信号。重建后75项组合通过，退出0。
- 旧页面 `background-exports.spec.ts --grep 'dispatch publication' --project=desktop --workers=1`，2项失败，退出1；`r24-browser-red.log`。实际按钮触发后，执行信号的已取消准备检查次数为1；第一版门禁构建定向4项通过。
- 复核推动取消故障用例改用推进时钟，并加入后继/idle及超时组合；`r24-terminal-clock-red.log` 为6 failed / 59 passed，退出1。afterSave 重试明确报“已有其他终态”，beforeSave 则暴露完成时间漂移。修复后核心65项通过，退出0，`r24-terminal-clock-green.log`。
- 原生 cancelled 事务完成后，测试延迟20ms把应用回执导向错误分支；旧页面保存重试仍停在等待保存，桌面1项失败，退出1，`r24-clock-browser-red.log`，错误上下文明确出现“导出记录已有其他终态”。这是受控丢回执，不是声称浏览器原生把同一事务先 complete 再 error。
- 首次最终检查出现测试探针 TS2345：unknown 属性不能传入 string 数组，退出2。补显式 typeof 收窄，不用类型断言或削弱配置。一次错位锚点修改立即 undo，随后重新读取目标行再编辑；未进入产品构建。
- 因复核发现补存边界，已停止第一轮扩围浏览器任务，SIGTERM；该任务的部分结果不计最终成绩。

## 最终工程与交互验证

定向十个文件178项单元/集成已通过，退出0，`r24-final-unit.log`；核心65项，Web适配16项。范围为 local-export-tasks，以及 mobile local 的 export-admission、web-export-admission、export-input-bytes、batch-export-root、batch-pdf-resources、batch-pdf-render-scope、batch-pdf-jpeg-alias、download-batch-pdfs、run-batch-export。

`pnpm --filter @solveflow/client build`、`pnpm --filter @solveflow/mobile typecheck`、修正后的 `pnpm exec tsc --noEmit` 与 `pnpm --filter @solveflow/mobile build:web` 均退出0；最终入口为 `index-97697521d84e954e05c9cf56394dcf09.js`。新增派发与丢回执定向6项通过、18.0秒、退出0，`r24-final-dispatch-browser.log`，不重复累计。

扩围 `pnpm exec playwright test tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/background-exports.spec.ts --workers=1` 为98项通过、6.4分钟、退出0，`r24-final-full-browser.log`。追加 `paper-preparation.spec.ts --grep 'busy progress and cancellation|slow preparation survives' --workers=1` 为4项通过、13.1秒、退出0，`r24-final-preparation-cancel.log`；合计102个独立浏览器用例。整理等待沿合成夹具和虚拟时钟，不是实际慢模型验收。桌面1440×1000、窄屏390×844，同一 Chrome154.0.8037.97，窄屏不是手机真机。

新增核心组合覆盖取消写入挂起时既有后继仍 queued、runner 未进入、waitForIdle 不提前结束；补写成功按 FIFO 继续，补写故障中断后继，保存重试不派发后继。推进时钟覆盖取消及超时的写入前/后故障、原终态不漂移。Web 组合保留真实队列与实际适配源码，内容投影/渲染/存储为合成；取消后再次满容量提交成功。

浏览器探针仅在隔离上下文临时包装原生 freeze/abort/throwIfAborted/put，finally 还原。同步触发点在 records 已置 running、快照赋值前；微任务点在派发继续之前，均在旧末次检查之后。信号检查次数是准备入口的代理，必须结合 Web prepare spy 理解；put 记录是尝试，不等于持久成功。丢回执场景另以原生 oncomplete 和重试后完整记录相等证明持久终态；不隐藏原错误或伪造业务成功。

## 实际批次与性能证据

隔离 QA 存储副本沿既有真实27题缓存。先保留首版门禁的 baseline/profile 产物 `interaction-r24-baseline/`、`interaction-r24-profile/`；该版本未含后续终态幂等修复，不用其成绩代表最终构建。

私有探针 `inspect-full-interaction-r24.py` 复用受控回放：常速/4× CPU的20份任务到第5页或以后进度时取消，随后4× CPU恢复一份。解除前十条截断，保存全程 longtask、27页 JPEG/回调及 performance.now 起止上下界。首录只有入口脚本；复核后另以网络响应URL收集动态包，停止采样后才启用 Debugger，按采样 scriptId 取VM原文。`interaction-r24-complete-profile/` 与 `verify-complete-profile-r24.py` 均退出0：采样19544点、22.100s、最大任务811ms、累计阻塞10138ms/69项，首delta1113.189ms单列。网络5份脚本、采样涉及4份VM源全部归档，html2canvas VM/HTTP字节相同，SHA256为 `7cc66a511335601454c1f079eeedcd827950ac1928cc988998432e5491f897de`。补录27页再次与金样像素/JPEG一致，最终三个独立成品共81页保真；重复比较基线不重复计页。源题/缓存不变，模型/pageerror均0。

初版 wallSeconds 误含采样/归档时间，旧值不作成绩；最终已在 stop 后立刻记录。最终 `interaction-r24-final-baseline/` 无采样恢复21.673s、最大长任务713ms、累计阻塞9682ms/68项；`interaction-r24-final-profile/` 为21.041s、660ms、9504ms/63项，均27次JPEG/回调。采样18815点，首delta1447.470ms是启动空窗，不分给首节点；起止标记的对齐范围仍有不确定，非精确时钟对应。单对基线/采样差异不作速度提升或采样开销结论。常速/4×取消至清理分别86.0/238.3ms与102.6/332.7ms，仅当次样本。

`verify-full-interaction-r24.py` 退出0，`pixel-comparison-r24-final.json`：两次下载各27张A4、6565217字节，存储与下载哈希相同；相对前轮金样，54页144DPI RGB及实际显示JPEG/位置均逐页一致，各27张独立JPEG。按 get_image_info(xrefs=True) 的实际出现项与 extract_image 校验，不拿共享资源表当每页显示列表。源题/缓存哈希分别 `baaa5796f47c31b39c7e5733ae7b57bec9f66b8d9eaa7a839343e239647190cf` / `afa2176493d635e41f00909319b1e473b536603a05bb7bae66892d5d97384f44`；两次均未改变、模型请求和pageerror均0、仅恢复一份下载，取消记录仍取消且无成品。

离线派生 `profile-analysis-r24/` 分析首个最终profile：绝对峰值660ms，JPEG顺序代理为第26页；第6页596ms。等速单调时钟/固定偏移近似的对齐区间宽112.095ms，取共同核心作互斥采样区间权重；不是精确CPU或函数耗时。两处主候选为递归DOM/样式解析及Canvas文本度量；数学拟合全程inclusive权重64.501ms，未据此缩小fit范围。补录同构建VM源后，`profile-source-verification-r24.txt` 的UTF-16坐标确认 jB→_B→qB→Rr 递归节点/读取computedStyle，renderTextNode→getMetrics→parseMetrics 则创建临时DOM并读offset度量字体。此源核对不抹去首录缺件，也不把旧窗口权重套给811ms的新补录峰值。旧R22和单对差异均不作提速证据；未修改绘制、编码质量、分辨率或序列化。

`pnpm lint` 与 `git diff --check` 退出0；文档初验2210/2203超过2200单位，已精简而不提高门槛，2203原日志保存在 `r24-docs-length-2203.log`。本页补全后 `pnpm docs:check` 退出0：208当前文档、68决策、128源码锚点、108冻结档案。未改工程管理脚本。

## 范围与遗留

本轮产品新增模型调用0，累计仍67；子代理推理与产品请求分开。未改缓存/容量/页数/字号/质量限制，未引入依赖、迁移、服务器或部署变更。Node24.21.0与项目要求24.19.0的既有警告保留。

独立审查无新增派发门禁的明确缺陷，指出的推进时钟故障及“后继＋补写挂起＋idle”组合均已据此补回归；未将静态审查当作运行成绩。完整 CPU 资料用于下一轮函数归因，不把长任务存在说成流畅验收完成。跨浏览器、物理设备、低内存和长时负载仍待验；总体目标继续。
