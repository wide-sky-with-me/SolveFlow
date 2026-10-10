# 浏览器配置与附加数据的恢复边界

日期：2026-10-07。状态：implemented。范围：设备配置、Web 文档适配、共享仓库与最近会话缓存。

## 背景

隔离故障注入发现，IndexedDB 中非字符串收藏被当成 I/O 错误，阻止整个应用启动；配置的 JSON/结构损坏也阻挡健康历史。最近会话的 localStorage 缓存写失败还能阻止读取、解题。首次失败与复测见[验收](../../../../docs/postmortem/2026-10-07-web-agent-audit.md)。

## 决定

[文档适配](../../../../apps/mobile/src/local/documents.web.ts)把非字符串值归为带键 LocalDataError；[仓库](../../../../packages/client/src/local-repository.ts)仅重建损坏摘要、在用户明确确认时重置损坏附加信息，真实 I/O 失败仍上抛。

[Runtime](../../../../apps/mobile/src/runtime.ts)保留损坏 settings 原值，以未配置状态开放历史与备份并显示修复入口；仅用户保存有效配置后替换原值。设置恢复不自动执行模型请求。

[Web 平台](../../../../apps/mobile/src/platform.web.ts)将最近会话缓存降为非关键数据；[提示模块](../../../../apps/mobile/src/local/recent-session-warning.ts)只保留当前固定文案，失败可见，缓存恢复后清除。IndexedDB 与 URL/history 错误不进入此降级路径。

## 放弃的方案

自动覆盖坏配置会破坏诊断与恢复依据；让坏附加数据阻挡全库已被故障注入证明不适用。统一吞存储异常会掩盖实际读写故障。未采用这些方案。

## 后果与限制

坏配置无法自动恢复模型信息；SecureStore 旧密钥不猜测归属，需重新填写。缓存不可用时刷新后的题目定位依赖有效 URL 或用户手动选择。浏览器元数据键整体损坏、真实容量故障和原生极端环境不由这些降级覆盖。

## 验证

相关单元、隔离浏览器及构建命令、首次失败与最终成绩归[验收报告](../../../../docs/postmortem/2026-10-07-web-agent-audit.md)。Android 真机与实际上游服务本轮未验。
