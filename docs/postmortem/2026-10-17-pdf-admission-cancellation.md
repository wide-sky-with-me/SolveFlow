# PDF 首次入队写入期间取消补验

日期：2026-10-17。范围：本机 Web 3100、前台准入/独立导出队列、取消状态恢复。不提交、不推送、不更新 Mac；保留既有未提交改动、数据与服务。

## 缺陷与修复

前轮的独立消息任务只处理调用 enqueue 之前的取消。首次 queued 元数据保存期间，调用者尚未获得 ID，队列也未登记可取消执行；直接 submit/enqueue 调用者取消后仍可接受并运行。前台拿到 ID 后再补取消虽常能及时阻断绘制，但不闭合这个所有权边界。

[队列](../../packages/client/src/local-export-tasks.ts)接受可选准入 signal，在调用前、进锁后、首次写入兑现后及 pump 前检查。写入中取消保持原 I/O 锁及捕获输入所有权，写入完成后补 cancelled 再抛原取消原因；初写失败或取消补写失败保留有界取消状态，保存重试不运行 runner。取消不打断无关任务，正常接受后准入 signal 不隐式控制后台生命周期。[Web 适配](../../apps/mobile/src/local/web-export-tasks.ts)透传信号，原错误收尾才释放字节、订阅与提交锁。[前台](../../apps/mobile/src/components/batch-pdf-export.web.tsx)显示“正在取消…”并禁用重复取消，收尾后恢复按钮。取舍见[决策](../../.agents/notes/implemented/storage/2026-10-17-pdf-admission-cancellation.md)，当前语义见[批次 PDF](../subsystems/batch-pdf.md)。

## 环境与失败证据

工作区 `/home/yhr/workspace/SolveFlow`，分支 `feat/batch-pdf-unified`；复用已由本会话启动的 `node scripts/web-server.mjs`，URL 为 `http://127.0.0.1:3100/`。Node 24.21.0 与根固定 24.19.0 的既有警告保留；pnpm 11.7.0、Vitest 5.0.0、Playwright 1.63.0、Chrome 154.0.8037.97。桌面 1440×1000、移动视口 390×844、单 worker；移动视口不是手机真机。

先补核心十项失败回归，旧源码执行 `pnpm exec vitest run packages/client/src/local-export-tasks.test.ts` 为 10 failed / 38 passed，退出1；覆盖已取消、锁等待、初写挂起/故障、补写故障、queued 发布的同步/微任务取消。原始日志 `.runtime/pdf-production-2026-10-16/r23-admission-red.log`。随后补了初写失败后中断其它等待项期间的迟到取消、已接受信号语义及无关队列保持的回归。

旧 Web 构建执行 `pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts --grep 'queued storage acknowledgement' --project=desktop --workers=1 --output .runtime/pdf-production-2026-10-16/r23-browser-red`，两项均因缺“正在取消…”反馈失败，退出1，日志 `r23-browser-red.log`。测试在真实 queued 事务已经提交、完成通知尚未交还应用时点击实际取消按钮，不伪称强制冻结或终止原生事务。

首轮新回归 159 项通过，但移动类型检查因 `disabled` 含 undefined 触发 TS2375/退出2；改为明确布尔值，不放宽 strict 或组件类型。重跑类型/构建和新增浏览器场景退出0。首轮 `pnpm lint` 的源码边界通过，但当前 PDF 文档2209 units超过既有2200上限；精简该段，未修改门槛。

## 当前验证

最终 `pnpm exec vitest run` 定向以下十个文件，共160项通过，退出0，日志 `r23-unit-final.log`：核心 local-export-tasks，加移动 local 的 export-admission、web-export-admission、export-input-bytes、batch-export-root、batch-pdf-resources、batch-pdf-render-scope、batch-pdf-jpeg-alias、download-batch-pdfs、run-batch-export。核心51项，适配12项；等待 I/O 期间仍持有提交锁，取消完成后可再次接受满容量输入。

`pnpm --filter @solveflow/client build`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile build:web`均退出0。当前应用主包 `index-3eb394a55afe039a9bf1ea1d6bf048b2.js`，并非 DSH GUI；此后没有产品源码修改。

新增浏览器 `--grep 'queued storage acknowledgement' --workers=1 --output .runtime/pdf-production-2026-10-16/r23-storage-browser` 四项通过、16.3秒、退出0。桌面/窄屏均核对取消按钮可见且禁用、状态在视口内、无 running 写入/绘制/模型/下载；注入取消补写 QuotaExceededError 后，记录显示等待保存、重试只补取消；明确重新导出后得到两页 PDF、仅一个成品文件/计数、一个下载，原题和答案不变。窄屏截图已实际查看。

真实题组首轮回放退出1：探针把字符串表达式交给 `wait_for_function`，触发页面已有 CSP 的 EvalError；不是导出报错。仅将探针改成函数表达式，保留原 CSP、初次日志 `r23-native.log` 和私有失败目录 `admission-cancellation-r23`；重试写独立 `admission-cancellation-r23-retry`，不覆盖原失败。私有脚本 `.runtime/pdf-production-2026-10-16/accept-admission-cancellation-r23.py`，后补 `--name` 选择新的独立输出目录，未改变回放行为。

重试回放退出0：从既有隔离 QA profile 只取存储快照，在全新浏览器上下文处理真实27题；正常与4× CPU限速各一次20份首写取消，后者注入取消补写故障并在记录页重试保存。两次均没有 running 写入、隐藏根/frame、下载或模型请求；最终都保存为 cancelled，未留下取消任务成品。再明确导出单份得到27页A4、6,565,217字节，下载与入库 SHA-256 一致；按144DPI逐页RGB及嵌入JPEG对比前轮同题夹具，27页全部一致。原题与整理缓存哈希保持不变；PDF整文件哈希因元数据不同不作跨轮相等断言。该比较不替代源图裁框的视觉正确性验收。结果 `admission-cancellation-r23-retry/result.json`，新日志 `r23-native-retry.log`。

扩围 `pnpm exec playwright test tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/background-exports.spec.ts --workers=1 --output .runtime/pdf-production-2026-10-16/r23-full-browser`：92项通过、6.5分钟、退出0；覆盖已有导出、后台恢复、分段取消、错误重试、20份ZIP及新增首写取消路径。追加 `paper-preparation.spec.ts --grep 'busy progress and cancellation|slow preparation survives' --workers=1 --output .runtime/pdf-production-2026-10-16/r23-preparation-cancel`：4项通过、13.7秒、退出0，覆盖桌面/窄屏长列表和慢整理的显式取消。后者沿既有合成夹具与虚拟时钟，不是实际模型慢请求验收；浏览器独立用例合计96项，不重复累计此前定向四项。

`pnpm lint` 最终退出0：源码边界、206份当前文档、67份决策、127个源码锚点、108份冻结文档通过；`git diff --check`退出0。PDF当前文档超限的两次失败为2209和2205 units，继续精简至门槛内；未改策略。私有脚本 `--help`退出0，新增参数在写输出目录前校验，重跑应选未存在的新目录。收尾只改证据文档，未重建或混入新产品代码。

只读独立审阅未发现本次准入目标内的新阻断问题。审阅关于旧 queued 取消可能泄漏容量的初步推断，已被其真实 Web+队列探针撤回，未据此扩修；它指出的迟到取消、无关任务与准入生命周期边界均已固化为本轮回归。子代理没有改文件或运行重任务。

## 限制与下一步

这次闭合首次写入取消交接，不宣称即时抢占 I/O、总耗时下降或整体已达生产发布。绘制/布局的同步长任务、其它浏览器、真机、低内存和长时负载仍待优化与验证。新准入 signal 只到接受边界，已有执行启动后的取消窗口仍依 runner 检查及任务终态收尾；不把旧问题或审阅假设列为本次新缺陷。

保留既有128MiB输入/成品上限、20份、每份300页、缓存/存储界限、字号、图像质量与任务期限；不改变持久化版本。失败重试只保存旧状态或成品，重新生成须用户明确操作。产品真实模型请求本轮0，累计仍67；子代理供应商使用不计入产品请求账本。
