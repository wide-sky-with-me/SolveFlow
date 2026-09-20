# 模型与供应商配置

> 本地 App/Web 已按 ADR 0013 改为设备配置，手机模型从“我的 → 设置”读取；下文 `.env` 配置用于保留的服务端和显式开发探针，不能改变手机设置。2026-09-18 核查确认 `deepseek-flash-guan` 已指向 V4.1 Flash，另一名称不等于升级；真实读图对照、思考参数差异及限制见 [读图延迟核查](READING_LATENCY_REVIEW.md)。

本地 0.1.28 的“深度思考”分两级：先选服务默认/关闭/开启，选开启后再选强度（低/中/高），参数协议单独选择（thinking.type、enable_thinking、reasoning_effort）。当前 DeepSeek 服务用“关闭 + thinking.type”；开启时 thinking.type 协议把低/中/高映射为 low/high/max。该设置同时用于连接测试、每轮工具调用和手动校验，保存时不改变模型引用名。

模型和供应商由服务端`.env`或系统环境变量决定，不绑定DMX、DeepSeek或实际型号，也不把Verifier默认设成Solver。决策见[ADR 0002](adr/0002-configurable-model-providers.md)。

## 基本填写格式

```dotenv
SOLVEFLOW_LLM_PROVIDER=your-provider
SOLVEFLOW_LLM_API=openai-completions
SOLVEFLOW_LLM_BASE_URL=https://your-provider.example/v1
SOLVEFLOW_LLM_API_KEY=
SOLVEFLOW_SOLVER_MODEL=your-solver-reference
SOLVEFLOW_VERIFIER_MODEL=your-verifier-reference
```

这不是完整的付费配置；容量、能力、价格和额度字段见[环境模板](../.env.example)。缺少必需字段时不执行真实调用，不猜供应商参数。支持`namespace/model:version`引用。PROVIDER是自定义标识，缺省时采用BASE_URL主机名。

| 用途 | 默认字段 | 角色覆盖 |
| --- | --- | --- |
| 供应商、协议 | SOLVEFLOW_LLM_PROVIDER / API | SOLVEFLOW_SOLVER_PROVIDER / API，Verifier同样配置 |
| 地址、密钥 | SOLVEFLOW_LLM_BASE_URL / API_KEY | SOLVEFLOW_SOLVER_BASE_URL / API_KEY，Verifier同样配置 |
| 协议选项JSON | SOLVEFLOW_LLM_COMPAT | SOLVEFLOW_SOLVER_COMPAT / SOLVEFLOW_VERIFIER_COMPAT |
| 图像/工具能力 | SOLVEFLOW_LLM_SUPPORTS_IMAGES / SUPPORTS_TOOLS | 两角色同名后缀覆盖 |
| 型号 | 无默认型号 | SOLVEFLOW_SOLVER_MODEL / SOLVEFLOW_VERIFIER_MODEL |
| 上下文、最大输出容量 | 无型号容量默认值 | 两角色CONTEXT_WINDOW / MAX_OUTPUT_TOKENS |
| 单请求输出目标 | 默认4096 | 两角色MAX_TOKENS |
| 输出预占策略 | 默认capacity；核实供应商总输出限制后可选request-limit | 两角色OUTPUT_BUDGET_MODE |
| 输入/输出报价 | 无厂商价格默认值 | 两角色INPUT_RMB_PER_MTOK / OUTPUT_RMB_PER_MTOK |
| 额外每请求费用 | 默认0 | 两角色REQUEST_FEE_RMB |

角色更换供应商或URL时同时配置该角色API_KEY，否则禁止真实执行，不把默认密钥发给其他服务。角色COMPAT完整覆盖默认COMPAT；可用字段以contracts/model.ts为准，拒绝任意headers或payload注入。

当前仅实现OpenAI兼容Chat Completions协议`openai-completions`；这是接口协议，不是供应商选择。其他原生协议还未实现。401/404/429等不会触发自动换型号或换供应商。

## 生效与迁移

`pnpm config:check`输出脱敏检查结果。编辑后重启API/worker，`pnpm dev`或生产构建后的`pnpm start`读取实际配置；系统环境优先于.env。`dev:demo`/`start:demo`仍为明确演示，不执行真实模型。

`pnpm config:migrate`把旧DMX_BASE_URL、DMX_API_KEY、DMX_HARD_QUOTA_CONFIRMED、DMX_HARD_QUOTA_RMB改为同后缀LLM变量；模型、URL/key、报价、预算与APP值保留。旧别名暂兼容，新旧值冲突则失败。迁移不重置账本；缺失的型号容量/能力需按供应商资料补齐。

## 当前本机记录（2026-09-10）

用户选择的两个引用均为`deepseek-flash-guan`，已保留并通过通用配置校验。[DMX公开报价](https://www.dmxapi.cn/api/dmxapi/rmb/pricing/public)将该别名标为官方直连DeepSeek-V4.1-Flash，公布上下文1000000、最大输出384000；[DeepSeek模型文档](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)列出对应版本、图像和Tool Calls能力。元数据只填写到本机配置中，未成为代码默认值。

M1验收已核实新引用的全天价格上界2/8元每百万tokens，以及显式总输出限制、思考关闭参数。本机输出预占使用经过协议审查的request-limit模式（4096），输入仍按完整100万容量估算；未知供应商保持默认capacity。更改型号/供应商后必须重新审查该模式，不能仅凭config:check通过认定兼容。

新引用已完成网页真实上传→Solver→Verifier PASS→SSE→移动显示，详见[M1真实记录](M1_LIVE_ACCEPTANCE.md)。历史预占保留，本次4请求后累计27.499072元，剩余2.500928元不足新一轮。`pnpm m1:preflight`会明确报SPEND_LIMIT。供应商实际扣费仍未核对，不能当作账户余额已用尽。
