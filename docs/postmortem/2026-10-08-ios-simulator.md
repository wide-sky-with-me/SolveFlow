# iOS 原生构建与模拟器验收

日期：2026-10-08。

范围：未提交源码快照，应用版本 0.1.76；Apple Silicon Mac、macOS 27.0.1、Xcode 27.0（27A266a）、iOS 27.0（24A434）iPhone 17 模拟器。Mac 使用 Node 24.19.0、pnpm 11.7.0、CocoaPods 1.17.0。只使用合成题图和虚构模型配置，不调用真实模型，不接触手机数据。

结论：Release 原生构建、安装及离线交互通过；修复场景启动基础、弹窗安全区域、设置键盘避让和弹窗横屏。第五轮截图发现的漏检已补回归并复测通过；模拟器产物不代表 iPhone 签名安装或发行完成。

## 变更与处理

- 原 Expo 配置没有 UIKit 场景声明，生成回归先失败。按[场景决策](../../.agents/notes/implemented/architecture/2026-10-08-ios-scene-lifecycle.md)升级必要补丁并启用官方插件，保留现有 Android 相机补丁。
- 第一次 XCTest 发现设置页返回按钮位于 y=8，与状态栏重叠；点击后设置仍存在。[弹窗容器](../../apps/mobile/src/components/motion-modal.tsx)在 iOS 独立窗口重新测量安全区域；复测通过返回位置与真正关闭的断言。[官方说明](https://appandflow.github.io/react-native-safe-area-context/api/safe-area-provider/)指出模态窗口可能需要独立 Provider。
- 增加[隔离冒烟脚本](../../scripts/test-ios-simulator.mjs)、[XCTest 用例](../../tests/ios/smoke.swift)及[生成工程脚本](../../scripts/create-ios-ui-project.rb)，复用 Xcode/CocoaPods，不新增 UI 测试框架。第二轮在系统相册定位失败；可访问性树证明 iOS 27 照片为 `PXGGridLayout-Info` 图片，已纠正用例。
- 第三轮已通过相册、保存、重启和历史 DOM，在填写模型配置时失败：键盘顶端 y=545，设置滚动区仍高 717，手势落入键盘而未滚动。[设置页](../../apps/mobile/src/components/settings.tsx)在 iOS 窗口根使用键盘避让，收缩可滚动区域；用例保留键盘显示时的实际输入与保存，并补字段不与键盘重叠的断言。
- 第四轮仍在字段定位失败，随后 Xcode 卡在系统诊断收集；先发送 SIGINT，再以 SIGTERM 结束已核对身份的本轮子进程，脚本完成模拟器清理。该轮结果包未完成，不能导出截图；保留日志及实际中止记录。后续使用 Xcode 支持的 `-collect-test-diagnostics never`，并将测试滚动限定到目标字段容器、支持双向低速滚动；不删除断言。
- 第五轮自动断言通过后，截图发现设置仍锁竖屏。[独立方向回归](../../tests/ios/smoke.swift)在旧包复现：工作区可横屏，打开设置后窗口变为 402×874，XCTest 65。按 [RN 文档](https://reactnative.dev/docs/modal#supportedorientations)修正 iOS 弹窗默认方向为横竖屏，保留调用方显式限制；同时为完整流程补宽高断言。
- 首次依赖安装因大包下载超时失败；保持锁文件与完整性校验，设置本次有界下载超时后通过。首次共享构建因同步清单遗漏根 `tsconfig.build.json` 失败，补齐快照后通过。
- Expo 首次缺少用户缓存目录；创建 `.expo` 后继续。指定设备的命令在原生构建、安装成功后因 SSH 无法执行 Simulator GUI 激活而退出 1；改用 generic 编译与 XCTest 分别核验，未增加系统自动化权限。复用步骤见[操作指南](../cookbook/ios-simulator.md)。

## 验证结果

以下重复复测不累计为不同样本；完整失败证据保留在被忽略的 `.runtime/`。

| 实际命令或阶段 | 退出码与结果 |
| --- | --- |
| Mac `pnpm install --frozen-lockfile --fetch-timeout=300000 --network-concurrency=8` | 0；同锁重试 |
| Mac `pnpm build:shared`、资源准备、iOS prebuild、`pod install` | 各 0 |
| Mac `pnpm --filter @solveflow/mobile exec expo run:ios --configuration Release --device generic --output .runtime/ios-acceptance/release --no-bundler --no-install` | 0；修复弹窗后增量编译仍为 0，0 errors / 1 warning |
| `pnpm test:ios:smoke --app=<本次 simulator .app 绝对路径>` | 前三轮脚本 1 / XCTest 65；第四轮断言失败后以 SIGTERM 中止诊断收集，XCTest 无退出码、脚本 1。第五轮与最终第六轮脚本及 XCTest 均 0；各轮模拟器关闭与删除通过 |
| `pnpm typecheck` | 0；弹窗修改后移动端 typecheck 再次 0 |
| `pnpm build:mobile` | 0；Android/iOS Hermes 与 Web 导出及资源检查，发生在弹窗修复前；不是 APK 构建 |
| `pnpm exec vitest run --project offline tests/unit/ios-scene.test.ts tests/unit/dependency-compat.test.ts --maxWorkers=1` | 0；2 文件、4 测试 |
| 原生文档/导入适配单元测试 | 0；2 文件、7 测试 |
| `pnpm lint`、`pnpm docs:test`、脚本语法检查 | 0；文档管理回归 20 测试，文档检查覆盖 86 当前文档、20 决策、31 源码引用与 108 冻结档案 |
| `pnpm deps:audit --json` | 1；2 critical、5 high、1 low，未在本轮修复 |
| Expo `install --check` | 1；仍有 SDK 推荐版本差异，未批量升级模块 |

模拟器产物位于 Mac 独立快照的 `apps/mobile/.runtime/ios-acceptance/release/SolveFlow.app`。构建阶段证据在 `.runtime/ios-acceptance/`，每轮 UI 证据在 `.runtime/ios-smoke-*/`，包含退出码、日志、`ui.xcresult`、截图与可访问性树。本地主机汇总在 `.runtime/mac-ssh-2026-10-08/`；这些路径仅用于本次证据，不包含账户密码或真实题目。

第五轮 `ios-smoke-S724QO`：1 个 XCTest 用例、0 失败，用例耗时 102.199 秒；不将流程段落称为独立测试。通过冷启动、设置/说明导航、合成图选择与裁切保存、重启恢复与历史 DOM、设置及 Keychain 恢复、深色外观。横屏原断言只检查返回可点击，截图实际仍为竖屏，不能计为横屏通过；已补独立方向回归及完整流程的宽高断言。读取隔离 SQLite 验证题目、题图、摘要、设置各 1，运行记录 0；没有用回退页面代替 DOM 成功。该轮清理已核验。

最终 `ios-smoke-vXiaJd`：2 个 XCTest 用例、0 失败，总耗时 112.241 秒；独立横屏回归 11.024 秒、完整离线流程 101.218 秒。横屏窗口宽高与固定返回均通过，完整流程覆盖前述保存、重启、历史 DOM、设置/密钥与外观场景。SQLite 再次确认题目、题图、摘要、设置各 1，运行记录 0；自动清理通过。人工复核题图、历史、深色个人页及最终横屏设置截图，确认横屏布局与可见返回栏。

最终快照核对 536 个文件的 SHA-256，Mac 与本地主机一致，包含同期[Web 布局更新](2026-10-08-web-desktop-layout.md)的共享组件与平台文件；没有提交或推送。构建和交互成绩对应这份源码，未改写此前 APK 或官网考试报告。

最新应用已覆盖安装并启动到本轮创建的设置模拟器，随后关闭该模拟器并保留安装产物；防休眠进程和本轮 PID 文件已清理。最终 `pnpm docs:check` 的自动审批请求超时，改用其同一个入口 `node scripts/check-project-docs.mjs`，退出 0。

## 未验证项与剩余风险

- 尚未完成真机签名、iPhone 安装、TestFlight/App Store 发行；没有生成可分发 IPA。
- 未验证真实相机成像、系统分享与文件备份、真实模型联网、后台/中断和多设备兼容。iOS 没有 Android 前台服务能力。
- 本轮依赖审计仍有风险：node-forge、braces、source-map-js、sharp、MCP SDK 为 high，proxy-addr、shell-quote 为 critical，KaTeX 为 low；需要按实际消费路径单独修复及回归。
- Linux 本地检查使用 Node 24.21.0，存在与根版本要求不同的警告；Mac 原生构建使用精确要求的 24.19.0。
