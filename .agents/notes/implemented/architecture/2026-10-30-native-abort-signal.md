# 原生取消信号在启动时补齐缺失方法

日期：2026-10-30。状态：implemented。范围：Android/iOS 原生启动与共享任务取消检查。

## 背景

锁定的 React Native 使用 abort-controller，缺少共享任务依赖的 `AbortSignal.throwIfAborted()`。原生PDF此前只在导出内部兼容；批量补图、仓库写入、图片复核和模型预算仍会调用该方法。Android隔离模拟器中，旧包补图提交显示通用错误，未写入补图，也未开始重答。证据见[模拟器验收](../../../../docs/postmortem/2026-10-30-android-emulator.md)。

## 决定

在[原生启动](../../../../apps/mobile/src/startup.native.ts)进入应用前，为信号原型补齐缺失方法。[兼容实现](../../../../apps/mobile/src/native-abort-signal.ts)按当前实例检查取消状态；有可用reason时原样抛出，否则抛出名为AbortError的错误。方法不可枚举，重复初始化不替换已有实现。Web启动入口不加载该兼容层。

## 放弃的方案

只改补图组件无法覆盖客户端仓库和Agent内部调用；逐一替换共享层调用会让平台兼容规则散落，并扩大修改面。此前导出专用检查仍保留其独立取消语义，不借此修改AbortController、fetch或网络权限。

## 后果与限制

需要原生入口在应用运行时之前执行。后续SDK自带该方法时保持原实现。兼容层不能为旧控制器补造未保存的取消reason；这种情况下使用AbortError。它不改变任务队列、持久化协议或模型请求次数。

## 验证

[定向回归](../../../../apps/mobile/src/native-abort-signal.test.ts)先因缺少实现失败，补齐后覆盖活动/取消信号、原因对象身份、不可枚举和幂等。48项相关回归与移动端类型检查通过；设备复测和构建结果以本次验收报告为准，不用旧PDF通过成绩替代。
