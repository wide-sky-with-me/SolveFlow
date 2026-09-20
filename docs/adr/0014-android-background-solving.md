# ADR 0014：Android 息屏解题与本地诊断

日期：2026-09-17。状态：已按用户“手机息屏后程序后台也应该运行完”的授权实施，真机验收另行记录。

## 决定

Android 从可见界面发起解题时，启动非导出的 `dataSync` 前台服务，显示低优先级“正在解题”通知，并持有有时限的部分唤醒锁。保留同一 React Native 进程和 Pi 任务；AppState 进入后台不再取消解题。结果持久化后结束服务、移除通知、释放唤醒锁。用户主动取消继续生效。

不新增 Agent 框架或任务循环，不在服务中重新提交模型请求。服务使用 `START_NOT_STICKY`，进程被杀后不重放付费任务；重新打开应用沿用现有中断恢复提示。Android 13 及以上按系统要求申请通知权限，拒绝通知展示不扩大权限。

总任务仍限 120 秒，服务硬截止 120 秒，唤醒锁最长 125 秒。Solver 和 Verifier 阶段计时通过原生 Handler 向现有 AbortController 发事件，避免仅依赖会在后台暂停的普通 JS 定时器；Verifier 仍最多 20 秒。没有新增无限重试、自动换模型或电池优化豁免。

Web 使用原有 JS 计时器，浏览器关闭/系统冻结不承诺继续运行。iOS 构建与后台执行仍暂停。本次保障 Android 正常切后台和息屏；用户强制停止、系统杀进程、断网和厂商额外限制仍可能中断。

## 诊断与格式修复

新增版本化本地诊断元数据，按 runId 独立存储在已有 SQLite/IndexedDB 键值存储中，每次最多 64 条，删除题目时一并删除，无需修改既有题目格式。仅记录 HTTP 状态、请求输出上限、用量、结束原因、输出字节数、结构错误字段路径及生命周期；不记录密钥、原图、完整题干、模型正文、内部 thinking 或供应商原始错误体。

HTTP/网络错误在 Pi 将异常转换为 assistant 错误事件后仍保留业务错误码，避免统一误报为输出格式错误。最终 JSON 的结构错误与语法错误共享现有最多一次格式修复额度；修复仍复用 Pi 会话并计入总预算，独立验证要求不变，失败候选不发布。

## 官方依据

- [前台服务](https://developer.android.com/develop/background-work/services/fgs)
- [启动与权限](https://developer.android.com/develop/background-work/services/fgs/launch)
- [dataSync 类型](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [保持设备运行](https://developer.android.com/develop/background-work/background-tasks/awake)

实际结果见[后台诊断验收](../BACKGROUND_SOLVE_ACCEPTANCE.md)。

## 2026-09-17 真机修正：RN 后台 JS 生命周期

持续息屏真机测试在第二次模型HTTP200后停止推进，最终RUN_TIMEOUT。已核对锁定RN0.86.3的`JavaTimerManager.onHostPause/onHeadlessJsTaskStart`：普通前台Service不代表RN存在活动后台JS任务，计时回调仍可能暂停。官方[Headless JS](https://reactnative.dev/docs/headless-js-android)说明后台JS任务生命周期，具体接口以本仓库安装版本源码为准。

0.1.18在现有ReactContext通过`HeadlessJsTaskContext.startTask`登记`SolveFlowActive`，JS端任务只等待当前解题的完成信号，绝不创建/重放模型请求，不重建Pi循环。任务允许在前台开始，随后切后台；原Service仍START_NOT_STICKY，不使用默认可能重投Intent的服务实现。无新依赖。

JS只保留一个匹配runId的完成Promise；重复开始拒绝，过期ID不会释放新任务。模型结束、取消或启动失败时释放；原生Headless任务125秒兜底，原解题120秒预算和原生阶段计时不变。Service异常结束通知取消，终态不被迟到通知覆盖。独立验证仍20秒，不能把校验未知显示为通过。

这是基于源码和实机症状的修正，实际持续息屏验收以BACKGROUND_SOLVE_ACCEPTANCE.md为准，不用Headless注册成功代替真实完成。
