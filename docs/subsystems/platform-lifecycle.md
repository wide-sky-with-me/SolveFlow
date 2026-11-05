# 平台生命周期

运行时总览见[设备运行](device-runtime.md)。原生[启动](../../apps/mobile/src/startup.native.ts)补齐缺失的 `AbortSignal.throwIfAborted()`，不覆盖已有实现。历史可离线查看，解题需联网。

## Android及网页

Android前台服务支持后台任务与计时；未落盘结果不抗系统杀进程。

完整版Web直连模型需要页面存活；刷新后重填手工密钥或续取环境令牌。公网及中心考试已接收任务由服务端执行，回前台读取结果；服务重启不自动重放运行中的付费请求。公网断线恢复的接收边界、暂存期限与取消见[公网指南](../cookbook/public-photo-web.md#任务与连接恢复)，中心任务另按[中心平台](managed-exams.md)运行。

## 原生iOS执行与到期

[UIKit模块](../../apps/mobile/plugins/solve-background/SolveBackground.m)在任务开始前申请系统后台租期，进入后台后只给已派发任务最多20秒收尾，并保留到期清理窗口。系统可能更早收回时间，20秒不是保证。答题、等待校验、校验及结果保存共用租期，阶段切换不提前释放。

进入后台暂停批量新派发，已有任务可完成。到期后一次通知所有受保护运行，取消并保存终态；[准入控制](../../apps/mobile/src/local/background-admission.ts)等待清理完成，且确认回到前台，才恢复尚未派发的题。已取消项不自动重放付费请求，需用户明确重试。原生保护无法申请时不派发模型。

## iOS安装与边界

[Expo插件](../../apps/mobile/plugins/with-ios-background.cjs)把模块加入生成工程；必须重新编译安装iOS包，更新JS或网页不足以启用。缺少模块的旧安装包沿用后台停止行为，不调用不存在的桥接方法。

不使用音频或其他无关后台模式保活；不承诺长时间锁屏、系统杀进程、低内存或后台断网后持续执行。重启只恢复已存状态，不自动重答。系统到期事件和JS保存之间仍可能被强制挂起，已落盘数据才有保障。

选择原因见[后台决定](../../.agents/notes/implemented/architecture/2026-11-03-ios-background-grace.md)，核心回归、编译和模拟器范围见[验收报告](../postmortem/2026-11-03-iphone-input-background.md)。真实iPhone锁屏、切网及低内存仍需单独测试。
