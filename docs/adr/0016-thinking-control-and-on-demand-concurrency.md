# ADR 0016：设备思考控制与按需请求并发

日期：2026-09-18。状态：用户已明确授权。

## 决定

设备思考设置改为两级：一级为服务默认 / 关闭 / 开启，选开启后再选强度（低 / 中 / 高），参数协议单独选择（thinking.type、enable_thinking、reasoning_effort）。关闭与开启都通过已锁定的 Pi 0.85.1 兼容字段发送，不按型号或供应商写死；强度按协议映射，thinking.type 下低 / 中 / 高对应 low / high / max（DeepSeek 官方档位），其余两种协议为 low / medium / high。

知识点从首轮输出改为按需：brief 的 knowledgePoints 必须为空数组、knowledgeDetails 省略；新增 focus.kind=knowledge-list 请求，成功后独立缓存。这与 ADR 0015 的“详细步骤按需”同模式，都只为缩短首轮等待。

详细步骤、校验、知识点三类按需请求允许在同一题并发（上限 3 个），主对话 run 仍独占；准备阶段（读取记录、检查重复、写入排队记录）与结果写入串行执行，避免并发覆盖本地记录。

## 契约与兼容

- LocalModelProfile 新增可选 thinking{mode,protocol,effort}；旧 thinkingControl 保留读取并映射，设备上已保存的值自动迁移显示。
- run context 新增 knowledge-list；SolverInput 的 focus 枚举同步。缓存与去重按 kind + sourceRunId + number 判定。
- brief schema 收紧知识点字段；detailed 的 knowledgeDetails 由必填改为可选，改由运行时按 focus.kind=knowledge-list 校验。
- 思考开启且协议为 thinking.type 时声明 requiresReasoningContentOnAssistantMessages，满足 DeepSeek 对带工具历史轮次回传思考内容的要求。
- 连接测试、每轮工具调用与手动校验共用同一思考设置，参数被服务拒绝时直接报错，不自动换模型或协议。

## 边界

并发上限未做真实网络压力测试；思考开启后的解题速度与准确率未做对照评测。实际记录见[验收](../THINKING_KNOWLEDGE_ACCEPTANCE.md)。
