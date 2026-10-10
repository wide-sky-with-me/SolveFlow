# 0.1.75 APK 构建与覆盖安装

日期：2026-10-06。

范围：当前工作区最新代码构建为 0.1.75 / code 76，同签名覆盖升级用户连接的 iQOO Neo9 / vivo V2338A，Android 16。只做本地备份、安装和只读交互，没有解题、追问或模型连接请求。

结论：实际 APK 签名、包内页面、覆盖安装、安装哈希回读及 149 道题保留通过；设置页 ESAT/TMUA/TARA 可见。不是完整真机功能或准确率验收。

## 变更与处理

既有 0.1.74 APK 早于恢复修复、核验增强与界面结构整理，因此将 [版本配置](../../apps/mobile/app.config.ts) 更新为 0.1.75 / code 76，重新打包当前代码。没有新增存储迁移，也没有卸载、清库或降级安装。

升级前手机为 0.1.73 / code 74，共 149 道题。应用自带导出保存两卷到手机本地 `下载/SolveFlowReview`，不含模型设置或密钥；两卷分别为 108、41 道题，133,152,346、51,124,254 字节，末行均有对应 `complete` 标记。第二卷导出曾被自动审批要求明确授权；用户确认完成本地备份后继续。没有把备份复制到电脑或上传网络。

## 验证结果

### 构建与包内资源

- 首次 `pnpm mobile:apk` 因 Kotlin daemon 回环连接阻塞未完成。保留线程栈，仅停止本轮 Gradle 进程，外层退出 1。
- 按 [安装指南](../cookbook/android-release.md#kotlin-编译进程连接阻塞)，保留已有 `GRADLE_OPTS` 并追加进程内 Kotlin 编译，使用单次 daemon 重试。Gradle 显示 `BUILD SUCCESSFUL in 3m 5s`；后置签名检查因本轮 PATH 缺少 Java 退出 127，外层退出 1。补齐现有 JDK 路径后单独执行 `node scripts/check-apk.mjs`，退出 0，没有重复编译。
- 产物 `.runtime/artifacts/solveflow-arm64-local-0.1.75.apk`，17,293,166 字节；SHA-256：`2c9095af592b7ffb2e56985978eeb632e8c7caed6279358a31a02dfdd3fafa88`。保存对应 R8 mapping。签名与手机旧包一致；版本、私密值排除、Hermes/本地页面、外部播放器及存储探针排除检查通过。
- `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.75.apk` 退出 0：包内三份 DOM 文档、写作/化学/经济呈现、核验失败说明、公式、桥接、240 px 布局、离线资源及注入防护通过。这是 Chromium 检查。

### 安装与手机

Windows ADB 对唯一连接设备执行 `install --no-streaming -r`，日志返回 `Success`。安装助手在安装已结束、系统前台切换后执行 UI 防护检查而退出 1；没有重装或放宽防护，直接读取已安装版本与哈希确认结果。不能将助手退出码写成安装命令退出码。

手机实际回读为 0.1.75 / code 76，base.apk 的 SHA-256 与上述产物一致。`am start -W` 退出 0，冷启动 `Status: ok`，`TotalTime: 512 ms`；这是 Activity 启动测量，不是完整题目绘制时间。

升级后个人页仍为 149 道题；设置页 ESAT、TMUA、TARA 按钮可见。未修改考试或模型设置，未按模型连接测试按钮。6 个历史批次可见，题图数依次为 50、1、22、22、27、27；原有 50 题批次能打开到第 1 题并提供原图入口。未逐题比对所有记录内容。

`node scripts/check-boundaries.mjs` 与 `git diff --check` 退出 0；`pnpm docs:check` 退出 0。前轮 927 项离线、70 项功能 UI 与 20 项性能 UI 结果见 [结构整理验收](2026-10-05-structure-optimization.md)，本轮没有重复计为新成绩。

原始构建、线程栈、签名报告、安装日志、版本/哈希与 UI 核对位于 `.runtime/install-acceptance-2026-10-06/`。本机临时 pnpm 包装器和手机临时 UI 文件在结束时清理；备份保留供用户恢复。

## 未验证项与剩余风险

没有真实模型调用、完整准确率/误放行复测、多机型、相机/系统分享全集或存储极端条件验证。数据保留以题数与只读打开为证据，不是每条内容的哈希校验。内部测试证书不是正式商店发行签名；正式发布缺口继续由 [发布状态](../project-status.md) 跟踪。
