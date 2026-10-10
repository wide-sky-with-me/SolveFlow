# Android 构建与验收

本指南从仓库根目录执行。Node/pnpm 按根清单，Android SDK/JDK 按 `pnpm mobile:doctor` 的实际输出准备。iOS 另见[模拟器指南](ios-simulator.md)。

1. 运行相关单元/UI 验证与类型检查，确认当前树包含本次改动。应用版本和 versionCode 只在需要新包时更新 [app.config.ts](../../apps/mobile/app.config.ts)。
2. `pnpm mobile:apk` 编译 ARM64 内部测试包；该脚本准备共享包与本地资源，并运行签名、版本、私密值和播放器排除检查。输出路径由实际日志给出，不能把 `pnpm build` 称作 APK。
3. 对明确的产物运行 `node scripts/test-android-document.mjs <APK路径>`，检查实际包内 DOM/公式/桥接/安全布局。它运行 Chromium，不代表原生合成器或真机已通过。
4. 获准操作手机后确认设备与当前数据，使用同证书覆盖升级；不卸载、清库或替换真实题目作故障注入。读回包版本和哈希，记录相机、分享、键盘、后台与恢复结果。
5. 切题性能按 [实测脚本](../../scripts/test-android-pager.mjs) 的参数执行，例如 `pnpm test:android:pager -- --device=<serial> --steps=12 --direction=next`（将占位值替换为已确认设备）；从用户明确选中的保存批次执行，不提交新题。报告系统帧、逐帧画面、操作数量、内容和内存限制。
6. 日志、截图、录屏和 APK 保存于忽略目录，报告放 `docs/postmortem/` 并更新 [发布状态](../project-status.md)。恢复临时草稿、系统设置并清理自己的测试服务/文件。

构建脚本的 `--compile-only` 是兼容参数，本地设备应用仍可自行配置模型；不能照旧记录解释为无解题能力。内部测试签名不代表商店发布准备完成。真实模型请求仍需明确授权；只查看历史和动画无需付费。

覆盖安装前保留备份并核对 [存储兼容规则](../subsystems/storage.md#数据与事务)，不支持降级覆盖安装，不用卸载或清库绕过读取错误。写作、反应式和图内检查的字段兼容影响见 [学科呈现决策](../../.agents/notes/implemented/agent/2026-10-04-subject-presentation.md)。

## Kotlin 编译进程连接阻塞

若构建长期停在 `compileKotlin`，先保留日志并检查本次 Gradle 线程栈。只有确认停在旧 Kotlin daemon 的回环连接时，才停止本轮已确认的进程，使用进程内编译重试：

```sh
env SOLVEFLOW_KOTLIN_IN_PROCESS=1 SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk
```

脚本显式传递 Gradle 项目参数，保留原有 `GRADLE_OPTS`。该方式只影响本轮构建，不修改手机设置；不能把任意 Kotlin 源码错误都按守护进程问题处理，也不要停止其他构建进程。
