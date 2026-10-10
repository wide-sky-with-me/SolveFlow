# iOS 构建与模拟器验证

从仓库根目录在 Mac 执行；使用当前源码快照，保护未提交改动。远程同步排除 `.env`、密钥、真实题图、`node_modules` 和已生成的原生目录，同时包含根 `tsconfig.build.json`、锁文件与相机补丁。不要把 SSH 地址或账户凭据写进报告。

## 前提

- Node、pnpm 使用[根清单](../../package.json)的精确版本；完整 Xcode 已完成初始化，`xcode-select -p` 指向其开发目录。
- 安装 CocoaPods 与 Ruby。冒烟脚本复用 Homebrew CocoaPods 自带的 `xcodeproj`，不安装额外 UI 框架。
- `xcrun simctl list runtimes --json` 中存在可用 iOS 运行环境；当前冒烟设备类型为 iPhone 17，需要兼容该设备的运行环境。
- 当前 SDK 57 通过[应用配置](../../apps/mobile/app.config.ts)启用场景生命周期，原因及升级注意事项见[决策](../../.agents/notes/implemented/architecture/2026-10-08-ios-scene-lifecycle.md)。生成工程需要同步该配置。

## 编译与运行

```sh
pnpm install --frozen-lockfile
pnpm build:shared
node scripts/prepare-mobile-assets.mjs
pnpm --filter @solveflow/mobile exec expo prebuild --platform ios --no-install
```

进入 `apps/mobile/ios` 执行 `pod install`，成功后回到仓库根目录。SSH 无界面构建使用：

```sh
pnpm --filter @solveflow/mobile exec expo run:ios --configuration Release --device generic --output .runtime/ios-release --no-bundler --no-install
```

产物在 `apps/mobile/.runtime/ios-release/SolveFlow.app`；下一步冒烟脚本自行安装和启动。Release 内置 JS 与 DOM，可验证脱离 Metro 的启动。桌面交互构建也可使用 `--device <本次模拟器UUID>`，标识来自实际 `simctl` 输出；`pnpm mobile:ios` 用于日常调试。原生目录属于生成产物，修复优先放配置或插件。

## 自动化冒烟

```sh
pnpm test:ios:smoke --app=/绝对路径/SolveFlow.app
```

替换为本次编译得到的 **iPhoneSimulator** 产物。脚本核对 bundle ID 与平台，创建全新模拟器，导入[合成题图](../../tests/ios/fixture.png)，生成独立 XCTest 工程并执行[用例](../../tests/ios/smoke.swift)。用例只保存测试配置，不点击连接测试或解题按钮。

每次的 `.runtime/ios-smoke-*` 保存步骤退出码、日志和 `ui.xcresult`。用例验证冷启动、导航、相册/裁切/SQLite 保存与重启恢复、历史 DOM、设置/Keychain 恢复、外观及横屏返回入口。全部断言通过且清理成功才返回零。断言失败保留截图和可访问性树；重复复测不累计新样本。

脚本关闭 Xcode 的额外系统诊断收集，避免失败后卡在 sysdiagnose；截图与断言仍保留。中止或结果包未完成时明确记录，不能将缺失附件当作通过。

结束时只关闭并删除本轮创建的模拟器，保留证据。不要使用 `shutdown all`、`erase all`，也不要向用户真机或已有模拟器注入损坏数据。远程长任务记录自己的 PID；临时防休眠应有时限并在结束时解除。

## 失败与边界

大 tar 包下载超时先看实际日志；可在本次安装命令中设置有界的 `--fetch-timeout`，保留锁文件与校验，不切换未知镜像或关闭完整性检查。共享编译若报根配置不存在，先核对同步清单，不修改 TypeScript 标准。

首次运行 Expo 若报 `~/.expo/devicectl-exists` 的 `ENOENT`，创建用户的 `.expo` 缓存目录后从 Release 阶段重试，不重新安装 Pods。

SSH 中指定具体设备可能在构建、安装后因 `osascript` 激活 Simulator 失败而非零退出；保留失败记录，使用上面的 generic 构建及冒烟脚本独立核对，不把 `Build Succeeded` 当作整条命令成功。

Pods、原生编译、安装、启动和交互分别判断，失败从对应阶段继续。旧日志、三端 JS/Hermes 导出和浏览器手机视口均不能代替原生结果。相机实际成像、系统分享/文件备份、后台生命周期、真实模型和真机签名需要独立验收；iOS 当前没有 Android 前台服务能力，任务应保持应用前台。
