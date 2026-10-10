# SolveFlow RN 本地应用

Android/Web/iOS 共用界面，默认直连设置中的模型；本地Web也可通过`.env`固定角色代理使用服务端密钥。Android/iOS 使用 SQLite/SecureStore，Web 使用 IndexedDB/内存密钥或临时令牌。具体运行语义见 [设备运行](../../docs/subsystems/device-runtime.md)，数据恢复见 [存储说明](../../docs/subsystems/storage.md)。

从仓库根目录运行 `pnpm dev`；Web运行与.env配置按[本地Web指南](../../docs/cookbook/local-web.md)，APK按[Android指南](../../docs/cookbook/android-release.md)构建。工具版本和命令入口以根清单为准。

iOS 原生构建及隔离 XCTest 按 [模拟器指南](../../docs/cookbook/ios-simulator.md)执行；模拟器验收与真机签名、发行分别判断。

首次配置可跳过，离线保存和查看题图；新解题、追问和连接测试需要联网。Android 前台服务保护已开始的任务，系统杀进程后标记中断，不自动重放模型请求。Web 后台策略与 Android 分别处理，不能保证后台永久运行。

修改前阅读 [本目录规则](AGENTS.md)。实际包、手机版本和未验证项见 [发布状态](../../docs/project-status.md)，不要把历史验收描述当成现行接口。
