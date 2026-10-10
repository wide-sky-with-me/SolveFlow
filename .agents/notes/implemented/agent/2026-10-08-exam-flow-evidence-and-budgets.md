# 不完整选项、可信度与分阶段资源预算

日期：2026-10-08。状态：implemented。范围：设备模型阶段、学生资源、独立证据检查与流式传输。

## 背景

今天用户要求尽力回答、明确识图警告、强模型接手及超时归因。服务端此前已把 SSE 放宽到 8MiB，但设备仍以 1MiB 截断；多次 HTTP 200 请求在约 1,049,000 字节附近断开。真实复测另发现 4096-token 输出耗尽，不能把所有失败都归为超时。证据见[复盘](../../../../docs/postmortem/2026-10-08-exam-flow-review.md)。

## 决定

[候选契约](../../../../packages/contracts/src/agent.ts)和[题干结构](../../../../packages/contracts/src/learning-content.ts)允许明确 optionsComplete=false 的选择题不提供 selectedOptions，并要求 uncertainties；不允许在未完整看到选项时猜标签。题干充分即可输出结论，选项对应仍 UNKNOWN。[学生 SYSTEM](../../../../packages/agent/resources/SYSTEM.md)、[通用方法](../../../../packages/agent/resources/skills/general/SKILL.md)和[考试方法](../../../../packages/agent/resources/skills/exams/SKILL.md)按影响结论的关键条件区分警告与澄清，不补造数字或条件。

[校验提示](../../../../packages/agent/resources/VERIFIER.md)要求 correctness 与 evidenceStatus 分别判断；证据 uncertain/insufficient 的 PASS 降 UNKNOWN，历史未提供该字段仍按旧覆盖规则读取，不能假装是新可信度检查。[编排](../../../../packages/agent/src/orchestration/solve.ts)优先用户备用组，无备用时可由已配置校验组完成一次接手；可重新评估非政策澄清，确实缺条件仍追问。接手消耗既有一次纠错机会，替换答案仍独立核验。自动纠错或检查遭遇可恢复模型故障保留有效答案、已有检查及明确警告，授权、取消与预算故障不降级。

[设备适配](../../../../packages/agent/src/pi/mobile.ts)自动主/备用各 240 秒，手动无备用主求解 300 秒；普通校验 120 秒、图/化学 150 秒、独立选择和长文/分小问 180 秒。既有仅近期流进展可延长 15 秒、一次晚格式修复可获得 20 秒的规则保留；有备用阶段不借用。重试共用所在阶段截止时刻；累计时间仍不限，次数预算不变。

[契约](../../../../packages/contracts/src/local.ts)增加有界工具、排队、模型名、图片数及阶段耗时元数据；只记录受审工具名、白名单资源路径和安全结果，不保存题干、表达式、响应或 thinking。校验器仍无工具，求解工具只有批准 read/calculate。[本地代理](../../../../scripts/web-model-proxy.mjs)和设备共用 8MiB SSE / 1MiB JSON 常量；代理 300 秒上限。Android [后台插件](../../../../apps/mobile/plugins/with-solve-background.cjs)从共享阶段和次数上限生成清理期限。

## 放弃的方案

无界模型路由和无限重试违反次数、权限与费用边界；未采用。为不完整选项猜原标签会制造虚假确定性；改为可用结论加警告。仅延长墙钟时间不能修复客户端断流和输出 token 截断。给 Verifier 工具会改变既有安全能力，本次不增加。

## 后果与限制

更长窗口及输出额度可能增加费用和校验等待，但首答独立展示。单模型自身也可能错误；PASS 不是官方正确率。旧诊断没有工具用时，不能据旧耗时断言工具是瓶颈。本地 Web 的输出配置调整不自动改写手机已有设置；原生需用户配置同等额度。

局部替代[备用解题](2026-10-08-explicit-backup-solver.md)的澄清接手限制与时间策略（排序和独立第三组仍有效）、[时间与传输](2026-10-08-device-time-and-stream-budget.md)的阶段窗口，并补齐客户端流限制；[无限累计时间](2026-10-08-unlimited-device-time.md)的取消和次数界限保持。

## 验证

118 文件、1066 项离线回归通过，包含超过 1MiB 正常流、超过共享上限的释放、不完整选项及有界澄清重试。真实题图首轮七例、21 次派发，实际工具耗时 0–1ms；token 配置复测和浏览器/构建结果见上述验收。
