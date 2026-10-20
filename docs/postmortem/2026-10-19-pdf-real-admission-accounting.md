# PDF 准入真实计量回归

日期：2026-10-19。范围：R87中断后由R88继续；Node 24.21.0、Vitest 5.0.0。产品实现、UI和部署未变。本轮用真实计量及原生克隆补准入约束，不宣称捕获优化已接入或整批流畅已验收。

## 改动与实际范围

[准入测试](../../apps/mobile/src/local/web-export-admission.test.ts)允许注入计量函数及容量上限，旧用例继续使用原fixture；新增用例调用真实[exportInputBytes](../../apps/mobile/src/local/export-input-bytes.ts)，并保留原生structuredClone。阈值缩为32KiB以隔离边界，验证和渲染/存储仍有替身，不是实际128MiB、真实题库或浏览器压力验收。

新增30项覆盖：

- 两种模式和两个入口下，重复长串、中文/emoji/转义，以及阈值前一字节、等于阈值、超一字节；超限发生在克隆、订阅及入队之前。
- 既有任务占用、执行后释放、Proxy原生失败后足额重试；JSON循环/BigInt的计量错误先于容量，容量错误先于不可克隆函数。
- getter/toJSON观察顺序，计量与捕获间没有微任务交接；随后修改原输入，已捕获内容保持隔离。该用例只固定所构造的观察序列，不证明任意副作用对象的计量与捕获等价。
- 捕获后两个让出点取消，以及捕获复核失败，均释放容量供足额重试。

这补充[完整输入原生边界](../../.agents/notes/implemented/storage/2026-10-19-pdf-native-capture-boundary.md)的真实计量证据，不改写[R86受限旁表成绩](2026-10-19-pdf-string-sidecar.md)。

## 来源审查与取舍

[副本生产者](../../packages/client/src/batch-print-variants.ts)按已知字段建计划后经BatchPrintCopySchema重建；这一路比整理内容的资格强。[prepareBatchExport](../../apps/mobile/src/local/prepare-batch-export.web.ts)仍浅拷贝seed.images并沿用seed.layouts中的嵌套布局；[hook](../../apps/mobile/src/components/use-batch-pdf-export.web.ts)的getPrepared直接返回ref。更重要的是，[适配层](../../apps/mobile/src/local/web-export-tasks.ts)在原生捕获之后还能用prepare回调的返回值替换prepared。

[缓存读写](../../apps/mobile/src/local/batch-print-cache.web.ts)确实有strict schema并返回解析数据，但这只是来源分支，尚未闭合所有叶型、写入和回调路径。R87子代理只留下中间结果后失败；主会话核对上述源码点，未把局部结论当作完整团队验收。因此不扩大submitCollected资格，不把原型白名单或snapshot资格当作全输入证明，旁表继续隔离。

## 失败与验证记录

首次新增测试矩阵少了一个右括号，Vitest在执行用例前解析失败，typecheck也报语法错误；失败日志和当时源码快照保留。修正括号后准入68项和typecheck通过，再补六项取消/复核释放用例：最终六文件168项（准入74项）、mobile typecheck、源码边界、文档及限定路径diff检查均退出0。实际命令见`r88-final-gate.json`；报告补入最终计数后仅重查文档，不重复应用检查。未删除断言或放宽阈值。

证据根为`.runtime/pdf-production-2026-10-16/`，保留`r87-preflight.json`、`r88-real-accounting-first-gate.json`、`r88-admission-first-source.snapshot.ts`、`r88-real-accounting-v2-gate.json`和最终关联检查、源码指纹与冻结复核结果。此前通过的68项只代表添加最后六项之前的版本。

## 验证服务恢复

本轮发现原3100无监听，旧任务句柄已失效；代理请求与直连均失败，原因未查明。临时助手用原dist成功返回旧主包，但其shell退出后Python子进程遗留，后续启动占口并发生断连。核对argv、cwd、监听PID及父进程归属后，仅用pidfd清理本轮创建的孤儿进程；首次墙钟启动时间断言有变化而停止，未发送信号。随后以exec直接托管同目录、同端口服务，根页和主包均HTTP200，SHA仍为c6742e…b0bdf。原QA资料未打开或改写；这只是恢复验证服务，不是新构建部署或浏览器验收。记录见`r88-original-gui-restored.json`与本轮服务恢复证据；活动目标期间保留新服务供后续验证。

## 待办

先建立覆盖整个输入的显式纯数据生产边界，并分别说明后续prepare回调的所有权与预算，再考虑接入旁表。整批净收益、取消/资源、PDF保真、首次整理、其它语料、长负载、跨浏览器与真机、完整UI仍需后续实际验证。本轮未跑浏览器、构建或全量套件，未生成新PDF，也没有新性能成绩。
