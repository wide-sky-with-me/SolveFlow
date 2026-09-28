# 本地配置：M0模型与M1应用

> 2026-09-21（0.1.38）：首次空题页的“配置模型与考试类型”与“我的 → 设置”使用同一配置页。默认考试可选 SAT、ACT、AP、未指定，仅作用于新题；接口协议可显式选择 Chat Completions 或 Responses。Base URL 不包含 `/chat/completions` 或 `/responses` 尾段。支持范围与真实对照见[考试设置验收](EXAM_PRELOAD_ACCEPTANCE.md)。

> 最新：用户已授权设备直连模型与本地存储，见[本地应用验收](LOCAL_APP_ACCEPTANCE.md)。当前安卓命令 `pnpm mobile:apk` 生成 `solveflow-arm64-local.apk`，启动后在设置页填写模型；不再需要 EXPO_PUBLIC_API_URL 或 SolveFlow 后端域名。下文较早的 API 缺失/编译检查包记录属于迁移前状态。iOS原生构建已暂停。

## 当前启动入口：React Native / Expo（2026-09-15）

`pnpm dev` 启动统一 RN Web（Metro）与 API/worker；`pnpm build` 导出 Web、Android/iOS Hermes 和本地公式资源，随后 `pnpm start` 启动生产预览。地址仍为 `http://127.0.0.1:3100`，API 健康检查在 `http://127.0.0.1:3101/api/v1/health`。同一时间仅启动一套服务，演示模式用 `dev:demo` 或 `start:demo`，演示题不调用模型。旧 Next 源码与专用依赖已移除。

Web 沿用根 `.env` 的服务端配置和当前浏览器匿名身份。原生端另在 `apps/mobile/.env` 中填写 **仅公开的** `EXPO_PUBLIC_API_URL`，不要复制模型、数据库或Cookie密钥。Web忽略该变量，始终访问同源API。原生发行构建要求HTTPS；debug模拟器可用Android `http://10.0.2.2:3100` / iOS `http://127.0.0.1:3100`，真机需可达的HTTPS服务。当前本地服务器只监听电脑回环地址，不能直接用局域网IP作为真机入口。

`pnpm mobile:prebuild` 只生成原生工程。`mobile:android` 需要Android SDK/JDK，`mobile:ios` 需要macOS/Xcode；两个命令复用3100端口Metro。完整步骤见 [移动客户端](../apps/mobile/README.md)，实际验证与限制见 [RN验收](REACT_NATIVE_ACCEPTANCE.md)。Android工具链已补齐并完成编译验证包，正式可解题APK仍需公开API地址；iOS仍缺Xcode或已绑定的云构建/签名环境。当前状态见[原生打包说明](NATIVE_PACKAGING.md)。

费用配置当前缺省或 `unlimited` 即无限额度；正数才启用可选有限模式，模型轮次/超时不取消。下面第3–7节保留早期30元阶段的历史配置，不作为当前启动前置条件。

2026-09-14最新决定：本地累计费用限制默认关闭，`SOLVEFLOW_LIVE_BUDGET_RMB=unlimited`，不再需要重置额度或确认供应商硬额度；旧账本保留。正数才启用可选有限模式。见[ADR 0005](adr/0005-optional-spending-limit.md)。下文30元硬边界及强制确认要求属于历史阶段约定。

数据库/MinIO/Web的初始化和启动见 [M1_ACCEPTANCE.md](M1_ACCEPTANCE.md)。`pnpm local:setup`只补齐缺失本地配置，已有模型/额度值保留。`SOLVEFLOW_APP_MODE`默认disabled，演示请用`pnpm dev:demo`；`config:check`只检查模型配置，应用入口另用`loadAppConfig`验证APP变量，错误不打印秘密。

配置模块只验证环境；`pnpm config:check` 构建配置包后显式加载本机 `.env`，仅输出脱敏状态，不调用模型。`liveExecutionImplemented:true` 表示已有本地真实探针入口，`liveValidationRecord` 指向兼容性记录；配置检查不执行模型请求，也不以配置通过宣称真实验收。首次真实成功结果见 [LIVE_PROBE_2026-09-10.md](LIVE_PROBE_2026-09-10.md)。普通 `pnpm test` / `pnpm probe:offline` 不读取真实凭据。运行步骤见 [M0_PROBE.md](M0_PROBE.md)，本次核实的公开报价见 [DMX_PRICING.md](DMX_PRICING.md)。

## 1. 创建只属于本机的配置

在项目根目录执行，**仅首次创建，已有`.env`时不要覆盖**：

```sh
(umask 077; set -C; cat .env.example > .env)
chmod 600 .env
```

这相当于复制模板，同时避免创建窗口内权限过宽或覆盖已有配置。用本机编辑器打开`.env`填写，不把密钥放入命令行参数、截图、聊天、Git或日志。`.env.example`只含占位符；`.env`已在忽略规则中，但忽略规则不替代谨慎处理。若需向协作者描述状态，只提供`safeSummary`的安全输出，不提供完整环境。

**暂不需要真实调用时，无须创建`.env`，也无须提供密钥。** `loadConfig({})`可用于完全离线开发。配置包本身不自动读取文件；后续入口显式加载本机环境后传给`loadConfig`。

## 2. 通用供应商与模型配置

使用SOLVEFLOW_LLM_PROVIDER、SOLVEFLOW_LLM_API、SOLVEFLOW_LLM_BASE_URL、SOLVEFLOW_LLM_API_KEY，以及独立的SOLVEFLOW_SOLVER_MODEL和SOLVEFLOW_VERIFIER_MODEL。完整变量与限制见[模型配置](MODEL_SELECTION.md)，不再固定DMX或具体型号。

`pnpm config:migrate`可保留值迁移旧DMX变量名。模型/厂商变更后核实容量、能力、价格和累计硬额度；config:check通过不等于真实兼容性验证。编辑后重启服务，系统环境优先于.env。

## 3. 费用边界必须先确认

本轮M0–M1累计真实测试预算为**人民币30元，不是每日额度**；含Solver、Verifier、修正、失败/超时和任何重试产生的费用。配置允许降低预算，不允许超过30元。

进入真实调用前须在所选供应商管理界面/官方支持说明中实际确认：

1. 专用令牌或账户是否提供**累计、不自动续期、用尽即拒绝的硬额度**；仅余额提醒、应用估算或每日重置额度不满足要求。不要假定平台一定提供令牌级硬限额。
2. 硬额度是否覆盖所选两个型号与全部计费项目，是否允许透支/延迟扣费，是否会自动充值或续额。
3. 确认专用凭据的剩余上限不超过30元，且不超过`SOLVEFLOW_LIVE_BUDGET_RMB`；不要与其他应用共用额度。测试已经消耗的金额不能通过新建令牌、换账户或重置本地配置清零。

**无法确认30元硬边界时，保持`SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED=false`，不要为了通过校验随意设为true。** 应用端累计费用账本/预占已接入本地探针，不能以这个人工确认开关代替真实硬限制；反之，供应商额度也不能替代应用预算计数。

## 4. 填写真实报价，未知即停止

四个`*_RMB_PER_MTOK`变量分别代表两个角色的输入和输出**人民币/百万tokens**。请核实所选供应商/模型及令牌分组的实际计费，并统一换算成人民币/百万tokens；不能套用另一供应商或币种的报价。

输入采用适用的保守未命中/最高价格，输出包含计费推理tokens；若有图片、请求级或额外费用无法覆盖，则不要开启真实调用，需先补齐预算策略。空白表示未知并阻止执行；显式0仅用于供应商明确确认零价的情形，不得把未知价格写成0。价格/分组变化后应关闭真实调用并重新核实。

## 5. 两道开关与门控

| 变量 | 默认/要求 |
| --- | --- |
| `SOLVEFLOW_LIVE_CALLS` | false；最后才显式设为true |
| `SOLVEFLOW_LIVE_BUDGET_RMB` | 30；必须>0且≤30 |
| `SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED` | false；只有实际确认才设true |
| `SOLVEFLOW_LLM_HARD_QUOTA_RMB` | 留空；填写已确认剩余硬上限，>0且≤应用预算 |
| `SOLVEFLOW_LLM_API_KEY` | 留空；仅本机服务端配置 |
| `SOLVEFLOW_LLM_BASE_URL` / 两个MODEL | 用户选择的实际供应商地址及两个独立型号引用 |
| 四个`*_RMB_PER_MTOK` | 留空；必须全部明确，有限且非负 |

布尔值只接受`true`或`false`，数字用十进制字符串。已填但非法的值即使离线也报配置错误；非项目环境变量可共存，未知`SOLVEFLOW_*`变量拒绝以防拼写误开。

`getLiveCallGate`返回固定原因代码，例如`LIVE_CALLS_DISABLED`、`MISSING_LLM_API_KEY`、`HARD_QUOTA_NOT_CONFIRMED`、`HARD_QUOTA_MISSING`、`HARD_QUOTA_EXCEEDS_BUDGET`、`MODEL_RATES_MISSING`。`assertLiveCallsAllowed`与`getModelConnections`未通过门控时均拒绝。

## 6. 供适配器实现者

`@solveflow/config`导出`loadConfig(environment)`、`safeSummary(config)`、`getLiveCallGate(config)`、`assertLiveCallsAllowed(config)`、`getModelConnections(config)`和应用配置验证。没有实际型号常量；`getModelConnections`只供服务端调用。

配置对象被冻结，仅含非秘密字段；密钥保存在模块私有WeakMap，序列化配置不会包含密钥。不要把配置对象复制/JSON重建后当作执行配置，克隆未被验证实例会拒绝。`getModelConnections`仅供服务端适配器临近dispatch时使用；用后不要记录。

`ConfigError`只包含固定code和受控字段名，不附带ZodError/input/cause。错误处理不得把完整环境或原始异常input输出给前端。通过配置门控只是必要条件：每次真实调用还须原子预占累计费用、保守token上限与超时，处理未知账单及不可用型号，不得自动替换模型或绕过预算。

## 7. 本次配置交接

2026-09-10：本机密钥已识别；预算及额度金额均为30元，两角色输入3元/百万tokens、输出9元/百万tokens，依据见 DMX_PRICING.md。用户本轮已授权继续真实探针，真实开关设为true；用户随后明确确认当前令牌已设置30元并关闭无限配额；硬额度确认已设为true，配置门控通过。代码不会代替用户声明后台状态。

## 8. 新增本地能力

受限calculate不需要额外密钥或环境变量，Solver默认启用，Verifier仍无工具；math Skill的依赖已就绪。新增组合已通过离线探针，未追加付费验证。

MCP HTTP工厂目前只在受信服务端组合层接收严格配置：`endpoint`、固定IPv4 `address`、可选`authorization`、默认false的`allowPrivateAddress`及可降低的连接/请求时限。配置必须由已认证身份解析，不能来自模型或客户端owner字段；密钥不进入提示。默认禁止私网，内部服务需逐地址审批，明文仅允许固定127.0.0.1。此工厂尚未通过环境变量接入解题入口，不要向`.env`添加猜测的MCP变量，也不要据此认为生产MCP已注册。

通用配置改造后，本机deepseek-flash-guan已通过config:check；当前代码无实际型号/供应商常量。后续真实网页Solver/Verifier PASS记录见[M1真实验收](M1_LIVE_ACCEPTANCE.md)。本机采用新型号全天最高2/8元报价及已审查的request-limit输出预占策略；历史记录未变。`pnpm m1:preflight`显示现有累计27.499072元预占，剩余不足新一轮；配置检查通过与费用准入通过是两项不同检查。详细模式说明见[模型配置](MODEL_SELECTION.md)。

## 用户明确续额与复杂题验收

在没有活动调用时，管理员根据明确的新预算授权执行 `pnpm build:server`、`node scripts/renew-budget.mjs --confirm-new-budget <唯一授权ID>`，再用 `pnpm m1:preflight`检查。不得因额度不足自行续额，重复ID会失败，旧账本不删除。供应商硬额度也需对应已授权的新窗口。

真实模式启动后，`pnpm test:m1:live --live --complex`使用自制二次函数综合题，通过网页上传和真实Solver/Verifier检查顶点、零点、交点、面积32/3、图示核验、公式/授权图片、SSE重放、刷新、移动布局及删除。此命令付费且不进入CI；预占不等于实际账单。

2026-09-14 可用性增量需要 `pnpm db:migrate` 应用第二份迁移（新增 runs.context，旧数据保留），再重启 API/worker/Web。`node scripts/usability-live-acceptance.mjs --live` 在真实服务运行时进行4轮自编题验收，会付费，不在CI默认执行；不带 `--live` 拒绝运行。

按题持续对话版本沿用迁移1–2，不新增迁移。构建并重启API/worker/Web后，`node scripts/question-thread-live.mjs --live` 可显式执行两道自编题的交叉追问验收（最多4个有界任务，会产生真实调用费用，测试会话结束后删除）。

## H5 摄像头访问

“拍一张”已接入网页实时相机，确认照片后进入裁切。电脑本机可访问 `http://127.0.0.1:3100` 并允许相机权限；手机通过局域网普通HTTP IP访问不能使用实时网页相机，需要手机信任的HTTPS地址。服务仍默认绑定本机，当前未部署手机可访问的HTTPS入口。权限拒绝/无设备时保留系统相机与相册入口。实现与设备验收边界见[相机验收](CAMERA_ACCEPTANCE.md)。
