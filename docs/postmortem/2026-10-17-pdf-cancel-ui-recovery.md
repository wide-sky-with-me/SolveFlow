# PDF 取消入口与记录页恢复补验

日期：2026-10-17。范围：本机 `http://127.0.0.1:3100/`、分支 `feat/batch-pdf-unified`，浏览器隔离合成数据及既有真实27题缓存副本。未提交、推送或同步 Mac。

## 问题与处理

[导出弹窗](../../apps/mobile/src/components/batch-pdf-export.web.tsx)的后台提交原来只设置 submitting，没有传准入 signal；首次 queued 写入确认前任务也尚未发布，界面既无取消按钮，也没有记录页入口可撤销。现复用 data.work 的控制器、进度与忙碌状态，向 submit 传入准入 signal。接受后关闭仍不取消独立 runner；所有权原因见[决策](../../.agents/notes/implemented/storage/2026-10-17-pdf-admission-cancellation.md)。

[记录页](../../apps/mobile/src/components/export-records.web.tsx)原来把取消也纳入全局 working，补存/下载等待 I/O 时所有取消按钮禁用，封住核心已支持的锁前取消意图。现普通操作同步防重，取消独立、按任务去重；普通操作等待收尾，取消不提前释放存储锁。列表底部操作失败原来只把错误放到屏外顶部，现提交后聚焦并滚动到反馈；同文错误再次失败也重新定位。

当前语义由[批次 PDF](../subsystems/batch-pdf.md)维护；本轮没有改绘制、JPEG质量、分辨率、容量、期限、磁盘格式或依赖。

## 失败与定向复测

私有脚本、日志、PDF与截图在 `.runtime/pdf-production-2026-10-16/`。

- 旧页面定向3项失败、退出1，`r25-ui-red.log`：后台首次写入等待时缺取消入口，记录补存时取消 disabled。最初反馈断言依赖新容器 testid，随后改用既有 alert 的实际可见区域复核；`r25-feedback-red.log` 1项失败、退出1，明确 viewport ratio 0。
- `background-exports.spec.ts --grep 'background cancels|records storage retry|records download errors'` 在新构建桌面/窄屏16项通过、48.9秒、退出0，`r25-ui-green.log`。覆盖前后台共享的准入分段、queued 回执等待/取消补写故障、明确新建成功；记录补存取消不重绘且清理文件，重复同文错误定位，连点及跨记录普通操作仅读取/下载一次。
- 移动端 typecheck、根 tsc 与 Web 构建退出0，入口 `index-0e22a1f552e43cfaa95165f065d8dc71.js`。已亲自查看窄屏取消收尾与第二次相同错误截图，反馈及底部操作可见；视口不是手机真机。

## 最终复验

`pnpm exec playwright test` 对 batch-pdf-export、batch-pdf-variants、background-exports 三个 spec 以单 worker 执行，114项通过、7.2分钟；另对 paper-preparation 的 busy progress/slow preparation 定向4项通过、11.7秒。合计118个独立用例，前述16项不重复计数；两份日志为 `r25-full-browser.log`、`r25-preparation.log`，退出0。Chrome154.0.8037.97、桌面1440×1000/窄屏390×844；整理等待使用合成与虚拟时钟，非慢模型验收。

`pnpm exec vitest run` 定向原十个队列/准入/渲染/资源/编码/执行文件178项通过、1.70秒，`r25-final-unit.log`；最终根 tsc 退出0，`r25-final-types.log`。没有替代成只跑新用例。

`inspect-ui-recovery-r25.py --name interaction-r25-final-profile --profile` 退出0，沿既有27题缓存先常速/4×CPU进行进度取消，再4×CPU恢复一份。窗口测量21.236秒，外部wall21.341秒、最大长任务766ms、累计阻塞9527ms/65项；当次取消至清理114.0/232.1ms，不外推为稳定上限。成品6565217字节、27页/27独立JPEG、仅一次下载，源题/缓存不变、模型与pageerror均0。没有以单对前后差异宣称提速。

`verify-mathml-r25.py --final interaction-r25-final-profile --output mathml-and-final-verification-r25.json` 退出0，最终成品再与金样逐页像素/JPEG/几何一致，连同隔离实验合计135个独立成品页；此前108页在此复核不重复累计。归档七份源码包含本次UI，流水线五份与前轮相同；入口哈希确已更换，采样涉及脚本均保存VM原文并与HTTP字节核对，未借旧入口证明新界面。最终日志为 `r25-final-native.log`、`r25-final-verification.log`。

## 绘制候选对照

根据[前轮采样](2026-10-17-pdf-dispatch-cancellation.md)，隔离网络回放在同一旧构建中尝试从 html2canvas 克隆排除完全裁空、且保留视觉 HTML 的 KaTeX MathML。依据[官方克隆入口](https://github.com/niklasvh/html2canvas/blob/master/src/dom/document-cloner.ts)，只修改该浏览器上下文的返回脚本，保存原文/改文及哈希，不修改产品或依赖。归档 API 获取的入口仍为原文，改文由独立 patch 产物标识，不混称为实际执行字节。

初版仅识别旧 clip，27页观察到91次分支但命中0，不能当有效优化；当前随包 CSS 与运行样式实际使用 clip-path:inset(50%)，修正后重新执行。有效对照各观察91次分支、合计997个子树元素，不等价于997次样式解析。4×CPU控制为20.082秒、最大长任务698ms、累计阻塞8781ms；跳过版20.421秒、592ms、8628ms。单对峰值下降、总耗时略升不足以证明稳定收益，候选未落地，也不把首版空命中差异称为提速。

`inspect-mathml-r25.py` 四次回放退出0；`verify-mathml-r25.py` 退出0，四份独立27页PDF共108页逐页A4几何、144DPI RGB、实际显示JPEG/位置均与原金样一致。源题/缓存不变、模型请求与pageerror均0、每次仅恢复一份下载；原/改入口哈希分别核验。样式提取首次正则回溯已主动终止，改用有界字符串定位；未用于成绩。

另经只读复核，[题页页眉/页脚](../../apps/mobile/src/dom/batch-copy-document.tsx)实际绘制题号、份序及整份对错统计，标准规划的完整页并非跨副本等价；直接复用JPEG会错页脚。未实现缓存或用反复传同一root的测试夹具制造收益；自然命中率为零只是静态推导，不称实测。去页脚后缓存正文再合成属于另项渲染架构，尚未实施。

## 遗留与范围

本轮产品模型调用0，累计仍67；子代理推理不计产品请求。只读审查未发现本轮取消实现的高置信新缺陷；普通操作防重及重复错误已补实际回归，跨任务取消同时受 I/O 阻塞的组合尚未专门补验。当前真实样本仍有绘制长任务；跨浏览器、物理设备、低内存与长时负载待验，总体目标继续。Node24.21.0与要求24.19.0的既有警告保留。

`pnpm lint`、其中的 `pnpm docs:check` 及 `git diff --check` 退出0，`r25-final-lint.log`：209当前文档、68决策、128源码锚点、108冻结文档。没有修改检查器、放宽长度或回填冻结成绩。最终采样18858点，4份VM源码与5份网络脚本已留档；采样权重仍非精确CPU计时。
