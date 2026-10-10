# 记录维护布局、历史兼容与原生同步

日期：2026-10-08。

范围：未提交源码快照；Web 宽屏与手机浏览器、Android 安装包、iOS 共用逻辑。真实本地数据仅从隔离只读副本核对字段和数量；回归使用合成题目，不调用真实模型。

## 变更与处理

用户截图中的维护按钮和错误条铺满屏幕。宽屏维护提示与批次主体共用居中宽度，按钮收紧；真正无法读取的题目显示带重读入口的卡片，仍可切换其他题目。窄屏保留原布局。

上轮更新公共错误文案后，旧记录的固定文案不再符合严格契约。只读检查 28 条记录，其中 13 条仅在 `session.runs[0].outcome.error` 失败；在副本内存中转换已知旧文案后，13 条均通过原 schema。按[兼容决策](../../.agents/notes/implemented/storage/2026-10-08-local-error-message-compatibility.md)修复显式读路径，不修改真实历史。

[设备运行时](../../apps/mobile/src/runtime.ts)统一调用 `solveOnDevice`；Android、Web、iOS 共用解题重试、备用模型、核验降级、诊断及读取兼容。Web 的 Node 环境代理保持平台专属，原生使用设备配置和 SecureStore。

用户随后要求延长期限并复核第三题。最新批次创建于09:23:55 UTC；第三题09:24:13 UTC的运行中，主模型两次被1MiB限制截断，备用45秒阶段超时。09:25:37 UTC重试中，主模型仍两次截断，备用38.3秒完成解答；校验两次HTTP 200后分别约16.4秒、14.5秒中断，代理明确记录 `response_limit`，不是模型缺失。总耗时103.5秒，已保留未验证候选。只读副本此时4条记录，无校验结构或正文外泄。

修复按[时间与传输决策](../../.agents/notes/implemented/agent/2026-10-08-device-time-and-stream-budget.md)：总期限180秒、主备用各60秒、核验按结构45/60/90秒；SSE上限8MiB，JSON保持1MiB。Android原生服务、阶段计时、Headless与唤醒锁同步共享常量，避免JS延长后仍在120秒被终止。

## 验证结果

- `pnpm build:web`：0，Web 静态产物已更新。
- 定向 `vitest run`（历史、导入、安全错误）：0，3 文件、114 项；涵盖 v1/v2、旧备份、原数据保留与拒绝任意异常文本。
- `playwright test maintenance-layout.spec.ts compact-batch.spec.ts`：首轮 2 通过、2 失败；维护用例错误地使用空摘要，应用合法重建摘要导致原字节断言失败。将夹具摘要改为有效值，保留完整字节一致断言；维护用例复测 2 通过。
- 宽屏检查 1280/1600/1920 px，维护条不超过 60 px、按钮不超过 180 px，提示及错误卡片与题目对齐；390 px 浏览器可操作且无横向溢出。验证打开维护、重新读取、切换健康题目，原保存数据完全一致、模型请求为零。
- 时间与传输定向回归：0，9文件、152项；覆盖新期限、晚到/取消、备用、修正和SSE上限，旧JSON上限仍拒绝。
- Android首次编译卡在旧Kotlin daemon回环连接，经线程栈确认后停止本轮进程，脚本1、Gradle143；仅设置环境项目变量的第二轮仍阻塞，同样中止。显式Gradle参数与隔离注册目录的第三轮编译0，4分2秒；它早于本轮期限延长，不作为最终APK。随后使用脚本新增的显式进程内编译选项构建最终版本。
- 原生文档/导入、编排与iOS场景：首轮31通过、1因Expo子进程EPERM失败；获准环境复测0，4文件、32项。
- `pnpm test`（最终180秒版本）：首次6失败、1037通过；5项使用旧期限，1项探针将新的总剩余时间直接传入120秒Worker硬边界。修正夹具时间，探针从硬边界导出的上限裁剪请求，不放宽Worker。复测0，116文件、1043项。
- 最终 `playwright test maintenance-layout.spec.ts compact-batch.spec.ts web-storage-boundaries.spec.ts verification-feedback.spec.ts`：0，28项通过，使用隔离3131服务。前轮相同28项不累计为新样本。
- 最终 `SOLVEFLOW_KOTLIN_IN_PROCESS=1 SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk`：0，3分10秒。APK版本0.1.76 / code77，17,341,346字节，同前包证书；签名、资源及私密值扫描通过。SHA-256为 `5003294a706efb0f10df5311f85af37f74e3ee079b1ae5d90d33b9ed715082f2`。包在 `.runtime/artifacts/solveflow-arm64-local.apk`，未安装到用户手机。生成的原生期限为180000ms，服务/阶段及Headless引用同一常量。
- `expo export --platform ios`：0，最终共享逻辑与Hermes/DOM导出通过；不是Xcode原生包。沿用既有Mac授权与已验证主机密钥，账户未变但SSH认证失败，未同步远程源码或重建模拟器包。
- 根及移动端 `tsc --noEmit`：各0；`pnpm lint`：0。管理回归 `pnpm docs:test` 默认环境首次1、获准环境复测0，20项通过；首轮日志未提供具体错误原因。
- 最终Web导出0；更新本地3100服务后页面与环境配置均HTTP200，三组配置可读取，不输出令牌、密钥或调用模型。

证据保存在被忽略的 `.runtime/ui-maintenance-2026-10-08/`，不提交真实数据或模型正文。

## 未验证项与剩余风险

浏览器移动视口不代表真机；本轮没有付费模型或准确率测试。APK未安装，iOS原生重建仍受SSH认证阻断；旧手机包和旧模拟器包没有本轮新期限。已保存答案可由用户手动重新校验，不自动重跑旧记录；实际供应商大流、手机后台180秒边界和iPhone签名仍需后续验收。
