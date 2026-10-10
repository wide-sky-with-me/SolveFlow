# iOS 27 场景生命周期

日期：2026-10-08。状态：implemented。范围：Expo iOS 生成工程。

## 背景

用户授权在远程 Mac 构建并运行 iOS 模拟器。该环境使用 Xcode 27 与 iOS 27 SDK；原 Expo 补丁生成的 Info.plist 没有场景声明。[Expo 官方说明](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md)明确指出，此组合需要 UIKit 场景生命周期才能正确启动。

## 决定

在 [应用配置](../../../../apps/mobile/app.config.ts)启用官方 `expo-build-properties` 的场景支持，并在[依赖清单](../../../../apps/mobile/package.json)与[锁文件](../../../../pnpm-lock.yaml)固定同一 SDK 内支持该功能的补丁。生成工程继续由 prebuild 管理，不手改 AppDelegate 或已有生成目录。

插件采用 MIT 许可，已安装包展开约 177 KiB，复用 Expo 的维护与生成逻辑；主要用于构建配置。它在不支持的 Expo 补丁或非标准 AppDelegate 上拒绝覆盖，避免猜测原生结构。

## 放弃的方案

本轮未选择升级整个 SDK 或批量更新相机等模块：现有 Android 相机有受维护补丁，需要单独验证。手工编辑已生成 AppDelegate 会在后续 prebuild 丢失，也没有必要重复官方插件逻辑。

## 后果与限制

生成工程必须重新生成才能应用新配置。SDK 58 已默认使用场景生命周期，升级时应移除该选项。此决定只解决启动基础，不证明相机、后台、分享或商店发行兼容。

## 验证

[生成回归](../../../../tests/unit/ios-scene.test.ts)先在原配置失败，缺少 `UIApplicationSceneManifest`；修复后通过，并检查场景代理、工厂协议及旧启动块移除。测试在临时目录执行并清理，不改真实生成工程。原生构建与运行证据另记验收报告。
