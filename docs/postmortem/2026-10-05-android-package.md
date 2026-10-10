# 0.1.74 APK 构建与包内验收

日期：2026-10-05；Asia/Shanghai。

范围：将当前考试题型、同题材料、写作/化学/图形呈现增强打入 Android ARM64 内部测试包。使用 Node 24.19.0、pnpm 11.7.0、JDK 17.0.20 和项目缓存 SDK；没有真实模型调用或手机安装操作。

结论：APK 生成、签名连续性及包内页面检查通过。包内 Chromium 检查不等于 Android WebView 或真机验收。

## 产物

| 项目 | 实际值 |
| --- | --- |
| 版本 | 0.1.74 / versionCode 75 |
| 文件 | `.runtime/artifacts/solveflow-arm64-local-0.1.74.apk` |
| 大小 | 17,344,614 字节，16.54 MiB |
| SHA-256 | `cb5d02db5755d27d752f82309222e1adb9b45287e7d36488e986cb358b9ef643` |
| 架构与签名 | arm64-v8a；内部测试签名，与上一版证书一致 |

同目录保留 `.sha256`、版本化 APK、当前包 `solveflow-arm64-local.apk` 和本次 R8 mapping。未改历史版本 APK。

## 变更与处理

[版本配置](../../apps/mobile/app.config.ts) 更新版本与 versionCode。[APK 文档检查](../../scripts/test-android-document.mjs) 新增写作、化学和经济图的包内场景，检查自然段与点评、mhchem、虚线/箭头、局部检查说明及未校验状态；沿用原有桥接、公式和安全断言。

按 [已有构建故障处理](../cookbook/android-release.md#kotlin-编译进程连接阻塞) 使用进程内 Kotlin 编译和单次 Gradle daemon，避免既有回环连接阻塞。构建重新生成原生工程、学生资源及三个本地 DOM 页面。

## 验证结果

以下命令使用项目指定的 Node/pnpm；缓存 CLI 经本次忽略目录内的 PATH 包装调用，不改变用户全局版本。

| 命令或检查 | 实际结果 |
| --- | --- |
| `pnpm mobile:doctor` | SDK/NDK/CMake/JDK 就绪，退出 0；初次受限沙箱 Java 探测失败，取得构建权限后复核通过 |
| `GRADLE_OPTS=…-Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk` | 退出 0；Gradle 4 分 16 秒，379 项任务 |
| 构建内置 `check-apk.mjs` | 版本、签名连续性、私密值、外部播放器、隔离测试入口和本地资源扫描通过；三个 DOM 文档齐全 |
| `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.74.apk` | 退出 0；新增三科学科场景及既有 240 px 布局、动态高度、帧就绪、历史/追问桥接、公式与注入防护通过，无网络资源请求 |
| `pnpm --filter @solveflow/mobile typecheck` | 退出 0 |
| `pnpm exec vitest run packages/contracts/src/subject-presentation.test.ts packages/client/src/exam-context.test.ts apps/mobile/src/dom/math-render.test.ts --maxWorkers=2` | 3 文件、12 项通过，退出 0 |
| `pnpm docs:test` | 20 项通过，退出 0 |

额外核对归档 APK 哈希与构建报告一致。Skill 标记检查最初只查 UTF-8 未命中，进一步核对 Hermes 的 UTF-16 字符串后，确认写作、化学资源及图形检查均进入包内；没有因此更改产品资源或降低功能断言。

日志与原始构建报告快照位于 `.runtime/apk-0.1.74-2026-10-05/`。APK 文档检查自行关闭 Chromium 并删除临时解包目录；Gradle 单次 daemon 在构建结束后退出。

## 未验证项与剩余风险

未安装到手机，未执行相机、系统分享、后台恢复及真机动画/长文性能验收。上次真机证据仍对应 [0.1.73](2026-10-04-android-install.md)。本轮使用内部证书，非商店发行签名。

真实模型准确性和化学/写作核验超时保持 [学科呈现验收](2026-10-04-subject-presentation.md) 的结论，本次打包不构成修复或复测。升级和数据兼容按 [构建与验收指南](../cookbook/android-release.md) 执行；整体生产缺口见 [发布状态](../project-status.md)。
