# ADR 0002：模型和供应商由服务端配置选择

2026-09-10，用户明确要求移除模型与供应商硬编码，使用环境变量中的引用名。此决定取代早期临时型号锁定。

统一使用`SOLVEFLOW_LLM_*`配置默认供应商、API协议、base URL、密钥及供应商累计额度；两个角色分别配置`SOLVEFLOW_SOLVER_MODEL`和`SOLVEFLOW_VERIFIER_MODEL`，也能独立覆盖地址、供应商、key和兼容参数。不提供实际型号默认值或自动fallback。旧`SOLVEFLOW_DMX_*`仅作迁移别名，新旧值冲突则报错。

`contracts/model.ts`定义不含Pi类型的项目协议。环境验证→父进程→worker→Pi构造共享这一契约；学生HTTP输入和模型输出不能选择endpoint/key。每run固定配置快照，启动时读取环境，修改后需重启；已有系统环境优先于.env。

当前已实现的协议为`openai-completions`，即OpenAI兼容Chat Completions，不限制厂商品牌。支持配置HTTPS域名/base路径、Bearer key、图片/工具、max_tokens或max_completion_tokens及严格JSON兼容选项。其他原生协议明确拒绝，不能仅改字符串就宣称支持。只允许HTTPS或本机127.0.0.1明文；禁止URL内凭据/query/hash、重定向及运行中目标替换。

密钥保存在服务端WeakMap中，公开配置对象不含凭据，不进入配置摘要/日志。角色如果更换供应商或endpoint，必须显式提供该角色key，不继承默认供应商密钥。只有通过调用门控的`getModelConnections`才能提取凭据。

移除旧型号的100万/384K容量和3/9元价格下限。上下文、最大输出、请求输出上限、输入/输出RMB报价、额外请求费用来自配置；按完整容量分别预占，不以未经验证的请求输出参数缩减上界。REASONING为能力声明，项目仍保持thinking off，不把能力开关当真实兼容性证明。

授权摘要绑定角色、供应商、endpoint、协议、型号、容量、兼容参数和报价。最少Solver+Verifier预算不足时在第一次请求前停止，最多10次模型授权，并保留原轮数、工具及120秒限制。SDK零金额字段只避免币种混用，RMB由父账本负责。

原30元账本、历史记录和初始化标记保留，不重置、不退款、不提高预算。新记录在version 1的model字段保存`route-<sha256>`，旧型号记录仍可读；摘要是内部授权标识。改供应商不能清除既有累计支出。

核实依据是锁定Pi 0.85.1的本机dist/types.d.ts、api/openai-completions.d.ts与实际协议回归；没有升级SDK或引入新外部包。config只新增到已有contracts的workspace依赖。

两供应商离线测试走环境→编译application worker→真实Pi Solver/Verifier→两个localhost HTTP服务，验证引用中的斜杠/冒号、不同key/base路径、不同输出参数、原图、Verifier无工具、进度脱敏和分角色计价。另测冲突、无默认型号、未支持协议、跨地址不继承key、旧账本及资金不足。

本轮无外部付费推理。用户当前`deepseek-flash-guan`及供应商地址保留为本机配置值；新型号真实图片/工具/Verifier能力仍待付费验收。

后续M1验收更新：已完成新引用网页真实解题与Verifier PASS，见[真实记录](../M1_LIVE_ACCEPTANCE.md)。新增每角色OUTPUT_BUDGET_MODE，默认capacity保持原行为；供应商契约已核实总输出受请求参数限制时允许显式request-limit，包含推理token，输入仍按完整上下文预占。变更属于配置化费用估算，未重置历史账本、退款或提高30元上限。
