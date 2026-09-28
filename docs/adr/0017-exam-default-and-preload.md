# ADR 0017：默认考试类型、受审方法预加载与 Responses

日期：2026-09-21。状态：用户已明确授权开发并进行同一 GPT-6 前后对比，手机验收待用户连接。

## 决定

在首次配置和设置页选择 SAT / ACT / AP / 未指定。选择与模型设置一同保存在本机；每次创建题目时把考试类型复制到题目记录。后续追问、重做、详细步骤、知识点和手动校验均采用该题的类型，修改默认值只影响新题。默认背景不能覆盖原题或用户明确更正，不提供自动模型路由。

对明确类型，本地 Pi 首次请求直接提供受审 `/skills/exams/SKILL.md` 与对应 `references/{sat,act,ap}.md` 的完整当前内容。提示词不再要求重复读取已经提供的两个文件。未指定类型与其他学科方法仍保留 Skill 发现和按需 read；calculate、工具预算、取消与内容策略不变。预加载不扩展工具权限，不读取开发目录，也不剪掉图像检查和 AP 论证要求。

设备模型接口增加显式 Responses 选项，沿用锁定 Pi 0.85.1 的官方适配器和 Agent 循环。旧 Chat Completions 配置继续生效，不自动切换接口或模型。两角色独立选协议，连接测试与解题用同一配置。

## 契约与兼容

- `ExamTypeSchema` 是固定枚举 `general/sat/act/ap`。`LocalSettings`、`LocalRecord`、Agent 输入新增可选 `exam`，旧记录按 `general` 处理；不能用当前默认值推断旧题。版本 1 的增量可选字段不需要清库或 SQLite 结构迁移，历史导出自动保留字段。
- Responses 使用 `max_output_tokens`；服务默认不发送 reasoning 参数，开启发送 `reasoning.effort=low/medium/high`，关闭发送 `none`。不支持关闭的服务正常报错，不暗中更换设置。Chat 的思考协议与 token 字段选择保持原语义。
- Responses 设置 `store:false`，请求加密 reasoning 用于无状态工具续接；只在 Pi 当前 run 内存中传递，既不展示也不保存到历史或诊断。请求目标严格匹配已配置 Base URL 下的 `/responses`，禁重定向、Cookie、自动重试和环境凭据回退。
- Solver、Verifier、一次格式修复和工具继续通过同一阶段实现；Verifier 不注册工具。120 秒总预算与已有调用次数上限保留。

## 验收方法

使用同一服务和 GPT-6、Responses、服务默认思考、相同原图、空历史及新 UUID，对冻结的旧按需读取版本与新正式实现交替测试。双方均收到相同显式考试类型；变化包括预加载及配套的条件读取提示。样本为 8 张用户 SAT 手机原图、2 张 ACT 官方 PDF 裁图和 2 张 AP Calculus AB 官方 PDF 截图；每题每版本两次，共 48 次解题，工具往返另计 HTTP 请求。

ACT/AP 官方答案或评分规则用于人工核对，不能只由另一个模型判断。样本与原始结果仅放本机忽略目录；公开文档仅记录方法、来源和汇总。报告需保留错误、未完成结果和耗时分布，不能据小样本承诺 SAT 1550、所有 AP 学科准确率或真机固定延迟。实际结果见[本轮验收](../EXAM_PRELOAD_ACCEPTANCE.md)。
