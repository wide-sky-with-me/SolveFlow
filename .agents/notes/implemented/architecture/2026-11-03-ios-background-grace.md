# iOS 在系统授予的短暂后台时间内收尾

日期：2026-11-03。状态：implemented。范围：原生iOS当前任务、待派发队列与后台过期清理。

## 背景

iOS进入后台立即停止全部任务，短暂切换应用也无法拿到即将完成的答案。iOS没有Android前台服务的等价长驻能力，不能承诺任意锁屏时长或进程被杀后持续解题。

## 决定

[原生模块](../../../../apps/mobile/plugins/solve-background/SolveBackground.m)使用 UIKit beginBackgroundTask，在系统允许范围给已接收任务最多20秒收尾，预留系统到期前的清理时间。通过[Expo插件](../../../../apps/mobile/plugins/with-ios-background.cjs)加入生成工程，无额外后台模式、音频保活或新依赖。

[引擎](../../../../packages/client/src/local-engine.ts)在答题、等待校验、校验及结果保存期间持有同一iOS租期，避免阶段切换提前释放。[批量队列](../../../../packages/client/src/local-batch.ts)后台只暂停新派发，既有任务可收尾。过期一次上报所有运行ID；[准入控制](../../../../apps/mobile/src/local/background-admission.ts)在取消和终态保存完成前不因回前台重新派发，防止清理与恢复竞态。旧二进制缺少模块时维持原停止逻辑。

## 放弃的方案

继续进入后台就全部取消会浪费短暂切换前已发出的请求；在后台继续派发新题会消耗有限租期。用音频或其他无关后台模式保活不符合实际用途。网页不能复用 UIKit，本决定不把浏览器冻结当作原生可控生命周期。

## 后果与限制

20秒是应用上限而非系统保证，系统可能更早收回时间。超时取消的模型不自动重放；回前台只继续尚未派发的题，已取消项须明确重试。该能力需要重新编译iOS二进制，不能仅更新JS或网页部署。真实iPhone切后台、锁屏、低内存及网络切换须另验。

## 验证

[本次报告](../../../../docs/postmortem/2026-11-03-iphone-input-background.md)区分核心队列/生命周期回归、Expo工程生成、Mac编译及模拟器、真机未验范围。平台语义见[设备运行](../../../../docs/subsystems/device-runtime.md#平台生命周期)。
