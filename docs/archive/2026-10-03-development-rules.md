# 开发规范迁移前快照

2026-10-03 管理分层改造保留的原始文本。仅用于追溯，不作为当前开发入口；当前规则见 [根规范](../../AGENTS.md)。以下路径按原仓库根目录解释。

~~~~markdown
# AGENTS.md — SolveFlow AI 开发规范

> 2026-10-03 用户明确：Pearson 交互播放器仅为外部官方样卷题源，手机通过 SolveFlow 拍照测试；播放器不是应用实体，不接入或打包。授权两个子 Agent 交叉审阅前端与解题核心/后端并修正，见 [交叉审阅记录](docs/CROSS_REVIEW_0_1_65.md)。

> 2026-10-02 用户授权新增ESAT、TMUA、TARA考试增强，沿用考试快照与受审参考机制，见[ADR 0022](docs/adr/0022-uat-uk-exams.md)。当前用户不便手机测试，先完成代码、自动化验证和安装包，真机测试等待后续安排。

> 2026-09-21 排版授权：相机内选择单题/批量，连拍默认同批、后台处理，批次可命名；历史“单题记录 / 批量记录 / 搜索”一行扁平展示，说明集中到使用说明。见[ADR 0018](docs/adr/0018-batch-solving.md)。

> 2026-09-21 最新用户授权：首次配置与设置可选 SAT/ACT/AP 默认考试，新题快照保存，旧题不受默认值变更影响；明确考试时预加载受审考试通则及对应参考，其他 Skill 继续按需读取。设备协议增加显式 Responses，保留 Pi 循环与原权限。见[ADR 0017](docs/adr/0017-exam-default-and-preload.md)。

> 2026-09-18最新用户授权：设备思考设置改为两级（服务默认/关闭/开启，开启后选强度，参数协议单独选择）；知识点与详细步骤一样按需生成（focus.kind=knowledge-list），详细步骤/校验/知识点三类按需请求可并发（上限 3）；同步优化打包与提示词/Skill。见[ADR 0016](docs/adr/0016-thinking-control-and-on-demand-concurrency.md)。

> 2026-09-17最新用户授权：本地 App/Web 默认简洁答案、核心结果加粗，完整步骤按需生成并缓存；校验默认关闭，只做生成后的“校验”按钮。下文强制独立校验规则仅适用于保留的旧自动校验路径。本地行为与兼容见[ADR 0015](docs/adr/0015-on-demand-answer-details.md)。

> 2026-09-15最新用户授权：手机直连模型、完整迁移本地应用，见[ADR 0013](docs/adr/0013-local-device-agent.md)。默认RN App/Web使用本地Pi核心、SQLite/IndexedDB及设备模型设置；下文服务端专属架构和API密钥仅服务端规则只适用于保留的旧服务路径。新路径密钥由用户在设备设置中输入，安卓安全存储、Web仅内存；不打包服务器.env。Pi导入仍仅允许packages/agent/src/pi/，不重写Agent循环。iOS原生构建暂停。

## 1. 作用域与当前状态

本文件适用于整个仓库，是给参与开发的 AI coding agent 的工作规范，不是拍题模型的 SYSTEM Prompt。禁止把本文件或其他开发上下文注入学生端 Agent。

M0真实命令行探针与本地M1清晰代数题网页最小纵切已通过，M0整体安全验收仍在进行。最新实现、实际测试数量与剩余验收项以 docs/PI_COMPATIBILITY.md 为准；不得据单题通过宣布M0全部安全完成。本地Web/API/数据库/私有存储已实现并验收，真实记录见docs/M1_LIVE_ACCEPTANCE.md；真实追问尚未追加付费验证，实际验收与运行方式见docs/M1_ACCEPTANCE.md，演示执行不得称为真实模型接通。实施范围见 docs/IMPLEMENTATION_PLAN.md，配置见 docs/LOCAL_SETUP.md，费用策略见 docs/SPEND_LEDGER.md。

工作开始时：

1. 确认实际 cwd，检查文件和已有改动；目录不一定已经初始化 Git。
2. 阅读本文件与 [技术方案](docs/TECHNICAL_DESIGN.md)，再读目标目录下更具体的 AGENTS.md（若存在）。
3. 检查真实 package.json、lockfile、配置和实现；规划目录不等于已实现目录。
4. 明确本次范围、验收和风险，先列最小步骤，再开始修改。
5. 如设计、实际 SDK 和代码冲突，报告具体差异；不能静默改架构或编造兼容接口。

遵守运行环境的上位安全约束。更深层 AGENTS.md 仅细化其目录规则；重大需求变更经用户确认后同步技术方案和 ADR。不要为了遵守旧设计拒绝指出其错误，也不要用新代码悄悄绕过安全边界。

## 2. 产品与不可变架构边界

SolveFlow 是“拍照/上传 → 裁切 → 多模态解题 → 独立校验 → 答案/步骤 → 同题追问”的学生端产品。

- 使用 Pi SDK/Extension 特化，不 Fork 魔改上游，不把 Pi CLI 子进程当服务接口，不重写 Agent loop。
- 首版不做 RAG、题库、知识画像、整卷批改、自动模型路由或任意代码执行。用户已授权同图明确指定最多4题，按题分组解答，见docs/adr/0006-question-groups.md。
- 主栈：React Native/Expo/React Native Web/TypeScript/KaTeX；Hono/Node；Pi/pi-ai；PostgreSQL/Drizzle；S3/MinIO；受限 SymPy 服务。用户已授权App与Web统一RN，见docs/adr/0012-react-native-universal-client.md；旧Next实现已按用户要求移除，前端仅维护RN通用客户端。
- 工程使用 pnpm workspace，不混用 npm/yarn lockfile。不同时引入 Fastify、Redis、第二套 ORM 或第二个 Agent 框架。
- 只有 packages/agent/src/pi/ 能直接导入 Pi 包。API、前端和共享契约使用项目类型，不泄漏 SDK 内部事件/JSONL。
- 学生端用途与内容边界见docs/adr/0007-solving-content-policy.md；Solver/Verifier固定共用CONTENT_POLICY，违规候选不得作为未验证答案发布。
- Pi 管模型/工具循环；业务编排只负责预算、持久化、状态机、Verifier 与最多一次修正。
- Pi、数据库和私有配置只能在服务端，不能进入浏览器 bundle。
- 型号、供应商、endpoint、角色凭据和型号容量/报价由服务端环境配置；不硬编码实际型号/供应商，不自动fallback。旧DMX变量仅作迁移兼容，见docs/adr/0002-configurable-model-providers.md。

### 计划中的目录职责

| 路径 | 职责 |
| --- | --- |
| apps/mobile/ | RN/Expo统一Android、iOS与Web，局部DOM公式/图文渲染 |
| packages/client/ | 三端共享API、SSE、提交恢复、题目对话逻辑 |
| apps/api/ | Hono 路由、鉴权、任务提交、SSE、worker 入口 |
| packages/contracts/ | Zod schema、HTTP/SSE 与结果协议 |
| packages/agent/src/pi/ | Solver/Verifier 的 Pi 适配与兼容性 |
| packages/agent/src/orchestration/ | run 状态机、预算和独立校验 |
| packages/agent/src/tools/ | 三类核心业务工具与受限文件/脚本适配 |
| packages/agent/src/mcp/ | MCP client、连接池、schema/结果转换；通过 src/pi/ 注册到 Pi |
| packages/agent/src/policy/ | 能力清单、路径/副作用与身份授权 |
| packages/agent/resources/ | 学生端 SYSTEM、VERIFIER、白名单 Skill |
| packages/db/ | Drizzle schema、迁移与数据访问 |
| packages/config/ | 服务端配置验证 |
| services/math/ | 受限 SymPy 与隔离测试 |
| tests/evals/ | 有许可的题目、真值与评分器 |
| infra/ | 容器/compose/部署 |

## 3. Pi 接入必做项

- M0 先核实已发布版本、Node engines、许可和实际类型，精确固定 Pi 依赖并提交 lockfile。
- 在 docs/PI_COMPATIBILITY.md 记录 Pi/MCP SDK及桥接版本、tag/commit、图片结构、分级工具配置、受限 read、ResourceLoader、Skill/MCP 探针、事件与 abort/dispose 结果。
- main 文档不等于已安装版本；禁止复制旧 data/mimeType 图片格式或凭记忆猜 SDK 方法。
- 受控 ResourceLoader 保留获准 Skill 的发现、描述注入与按需加载，只发现明确受审根；禁扫开发 cwd/HOME/父目录/AGENTS/CLAUDE/任意扩展。
- 不一刀切禁用内置工具：默认启用受限 read；ls/find/grep 按依赖启用；bash/powershell 与 write/edit 默认关闭，仅对已批准且隔离的脚本/产物需求启用。
- 默认 Solver 工具集为受限 read + 已配置核心业务工具 + 获准 MCP 工具，不硬编码三个工具。Verifier 仍无工具。按锁定 SDK 版本核实选择/覆盖机制，不猜 tools/noTools/excludeTools 语义。
- read 保留 Pi Skill 兼容语义，仅能读受审 Skill/参考资料和授权 run 文件；规范化路径、阻止穿越/符号链接逃逸与跨租户访问。cwd 和提示词不是沙箱，文件工具共用底层权限策略，不并存未受限同名实现。
- 启动/每 run 断言能力清单中的工具名、来源、schema 与权限一致，未知工具/权限扩大失败关闭；不能只因 read 出现就报违规。
- 模型根据 name/description 按需 read SKILL.md 和相对参考资料，可组合多个 Skill。学科选择是提示，服务端预加载只作关键策略补充/降级，不替代正常流程。
- 校验 Skill 所需工具/MCP 是否就绪，不将依赖缺失的 Skill 宣称为完整可用；Skill 正文和 allowed-tools 不授予权限，脚本单独审批/隔离。
- 通用斜杠命令、模板和文件展开关闭；显式 Skill 选择仅映射已安装白名单，不能执行任意扩展命令。
- Pi 核心不内置 MCP；使用服务端 MCP client + Pi Extension 桥接。stdio 由服务端启动固定程序，不依赖模型 bash；命令/参数/endpoint/凭据仅管理员配置。
- MCP 按 server+tool 白名单暴露，使用稳定命名并防重名/覆盖；校验 schema 与结果，限制超时/输出/外发数据。readOnlyHint 不替代实际副作用审查；首版无确认机制时不注册写入/发送/删除类 MCP 工具。
- MCP 用户状态/凭据按身份隔离；必要连接预热，单 run 能力快照固定，权限变更不自动扩大当前 run；撤销立即生效。记录断连/降级并传播取消，关闭连接不影响其他 run。
- 所有 session/订阅/子任务在 finally 清理，取消信号贯穿模型、工具和验证阶段。
- Pi 升级必须单独做兼容回归；不在功能开发中顺手升级全量依赖。

注意：产品 Agent 采用分级工具与资源权限，不等于禁止开发 AI 在获授权工作区使用正常读写、构建和测试工具；也不等于给学生端开放宿主全权限。

## 4. 编码与依赖规范

- TypeScript strict；外部输入使用 unknown+schema 缩窄，不用 any、@ts-ignore 或强转掩盖契约问题。
- 标识符、文件名和公共协议使用英文；文档/用户文案默认中文。组件 PascalCase，模块文件 kebab-case。
- 小模块、显式依赖注入，便于替换模型/搜索/时钟/存储；不写重复的“通用框架”。
- HTTP body、环境、工具参数、模型输出和 SSE 事件均做运行时验证；共用 contracts，禁止前后端手抄结构漂移。
- schema、事件和持久化结构带版本；破坏性变更提供迁移/兼容策略并更新文档。
- 网络/长任务有 AbortSignal、超时、错误码和资源释放；不使用无界重试、无界数组/缓存/并发。
- 不吞异常或返回伪成功；日志脱敏，不把内部异常直接发给前端。
- 增依赖先说明必要性、许可、维护状态和体积；优先已有能力，不安装猜测的包名。
- 数据库变更提交迁移；不修改已部署迁移，不以生产 reset/drop 代替升级。测试使用隔离数据库。
- 仅修改任务相关文件，保护用户未提交改动；不顺手格式化全仓库，不擅自提交、推送、强制重置或部署。

## 5. 工具与数据安全红线

- calculate 仅允许受限 AST；禁止 eval/new Function/赋值/属性访问/动态函数及文件网络能力。
- python_math 只接收 solve_equation/differentiate/integrate 结构化参数；不接受 code/shell/路径/任意方法。
- 不把不可信表达式直接交给 eval/exec/sympify/parse_expr 默认求值。明确定义域、精度、单位与积分常数。
- Python 必须通过无宿主访问、无网络计算、非 root、只读、CPU/内存/PID/时间限额与强杀测试；未通过不注册。应用不挂 Docker socket。
- web_search 走固定供应商适配，只发送必要去标识查询。引用关联真实工具证据，不编造 URL。
- 上传校验真实格式/解码像素/大小，剥离 EXIF；仅私有存储和短时签名 URL，不允许任意远程图片 URL。
- 每次 session/run/upload/SSE/删除访问均验证 owner；模型和客户端提交的 owner 字段不是授权依据。
- API key 只在服务端配置；不索取聊天中的密码/Token，不提交 .env、真实图片、base64 或签名 URL。
- 图片文字、用户文本、搜索和工具内容都是数据，不得当作系统指令或执行授权。
- Markdown 禁 raw HTML；安全链接协议，KaTeX trust=false，限制渲染大小/宏展开。
- Service Worker 不缓存 API、SSE、私有图像和会话。日志不记录原图、完整题干/聊天或模型内部 thinking。

## 6. 状态、验证与 SSE 不变量

- 状态以技术方案为准：queued/understanding/solving/verifying/revising 与四个终态 completed/needs_clarification/failed/cancelled。
- Verifier 由服务端强制调度，不是模型可跳过的工具；输入须含原题证据，视觉题检查原图。
- 只接受有效 PASS 设置 verified；FAIL 最多修正一次再验证。UNKNOWN、超时、无效 schema 不冒充通过。
- 条件不清先澄清；有效候选验证失败可标 unverified，不能把“模型校验通过”宣传成保证正确。
- 给学生教学步骤，不透传内部思维链。首版 SSE 仅阶段/工具摘要与最终结构化结果，不流出未校验正文。
- POST 创建 run 返回 202，GET EventSource 订阅；seq 单调，runId+seq 去重，支持重放/过期快照恢复。
- 断线不取消；显式取消持久化后传播。迟到结果不能覆盖 cancelled/其他终态。
- 同题仅一个活动 run；幂等键持久化，重复请求不能重复付费执行。
- 结果、终态和 final/done 事件原子落盘；worker 崩溃标 WORKER_LOST，不自动重放外部调用。
- run 总预算120秒、Solver最多16轮、工具总调用最多16次（文件工具8次，其余业务/MCP/脚本/写入合计8次，所有搜索入口合计2次）、修正最多1次、Verifier最多2次；细限额见方案第8节。Skill加载、MCP、重试和格式修复均计入预算。

## 7. 工作方式与变更顺序

1. 先读相关实现与测试；无实现时从 M0 探针起步，不一口气生成整个大型应用。
2. 先定义/更新 contracts 和失败场景，再实现服务端、适配层与 UI。
3. 优先最小纵切，按 M0 → M1 → M2 → M3 推进；不要把纯 mock 页面标成真实 Agent 接通。
4. Bug 修复先补能复现的回归测试，再做最小修复。
5. 验证实际运行路径，检查命令退出码；失败先定位，不删除断言/降门槛来变绿。
6. 文档、测试、配置示例与行为一起更新。模型/prompt/Skill 改动也视为行为变更并跑评测。
7. 新框架、额外工具、公开网络执行、范围扩张或破坏性迁移先说明取舍并获得确认，记录 docs/adr/。
8. 缺失凭据时继续 fake/离线合约测试，并明确真实路径未验证，不造假也不把密钥写进文档。

## 8. 命令约定（M0 与本地 M1）

当前实际可运行：pnpm install --frozen-lockfile、pnpm lint、pnpm typecheck、pnpm test、pnpm build、pnpm config:check，以及pnpm local:setup/infra:up/db:migrate/dev/dev:demo/test:integration/test:e2e。test先构建服务端包，build另含Expo三端JS/Hermes与本地DOM资源导出，不是APK/IPA编译。mobile:prebuild生成原生工程；mobile:android/ios需要对应SDK。mobile:doctor检查工具与API配置，mobile:apk生成ARM64内部测试APK（不是商店签名）；--compile-only产物不含API、不可解题，见docs/NATIVE_PACKAGING.md。集成测试使用随机隔离DB/桶，E2E需先启动dev:demo或start:demo，当前入口为tests/mobile-e2e。test:math/eval尚不存在，不得用占位命令假装通过。

新增pnpm m1:preflight（不付费；无限模式不读账本，有限模式额度不足非零退出）与pnpm test:m1:live --live（显式付费；先启动真实服务）。用户已授权累计费用默认无限：SOLVEFLOW_LIVE_BUDGET_RMB缺省或unlimited时不做费用预占，正数才启用有限模式，见docs/adr/0005-optional-spending-limit.md。历史账本保留，不自动清空；模型/工具次数、取消与超时约束不受影响。

| 命令 | 预期职责 |
| --- | --- |
| pnpm install --frozen-lockfile | 已有 lockfile 时可重复安装；首次初始化生成并审查 lockfile |
| pnpm dev | 开发模式启动 web/API/worker，地址以实际输出为准 |
| pnpm build | 构建所有 TypeScript 应用/包 |
| pnpm lint | 静态规则与依赖边界 |
| pnpm typecheck | 所有包严格类型检查 |
| pnpm test | 无真实凭据的确定性单元/合约测试 |
| pnpm test:integration | 隔离 DB/存储/任务/SSE 集成测试 |
| pnpm test:e2e | Playwright 移动/桌面关键链路 |
| pnpm test:math | 调用隔离 Python 环境的 pytest 与安全测试 |
| pnpm eval | 默认 fake/离线评测；真实模型需显式开关、预算与凭据 |
| pnpm db:migrate | 对明确目标环境应用已审查迁移 |

.env.example 仅含占位符、必填说明与安全默认；配置覆盖数据库、对象存储、主模型/Verifier、搜索、数学内部服务、Cookie secret、预算/限流/保留策略，以及 Skill 根、工具权限、MCP server/tool 白名单与凭据引用。真实环境变量名根据锁定 SDK 和实现定义，禁止猜测厂商变量名。

不要擅自启动替代服务器或使用已有端口；需要后台任务时记录进程/任务、验证准确 URL，结束不相关任务。用户没有要求启动服务时，纯文档任务不启动应用。

## 9. 必须覆盖的测试

- Pi/Skill：图片输入、分级工具集、受限 read、描述→正文→参考资料按需加载、依赖缺失、路径穿越/符号链接、禁止非授权资源/命令展开、事件、abort/dispose。
- MCP：无需模型 bash 的 stdio 启动、HTTP 接入、工具发现/过滤/重名/schema变更、owner凭据隔离、只读权限、超时/取消/断连降级、预算与连接回收。
- 解题：PASS、FAIL→修正→PASS、再次FAIL、UNKNOWN、验证超时、schema错误、模糊/多题澄清。
- 安全：跨 owner 的读/写/上传绑定/SSE/删除；图片注入；表达式执行/资源耗尽；XSS/危险链接。
- 可靠性：同题并发、幂等冲突、重复事件、断线恢复、过期游标、worker崩溃、取消迟到结果、预算耗尽。
- 数学：单位、浮点误差、弧度/角度、定义域、无解/多解与积分常数。
- UI：相机拒绝后的上传、裁切、窄屏公式、未验证标记、错误重试、追问和键盘可访问性。
- 隐私：EXIF移除、私有对象授权、过期/删除清理、日志脱敏、SW不缓存敏感数据。

真实付费调用必须 opt-in；CI 默认使用 fake。评测真值需有来源与许可，数学等价/容差明确；不能只用另一个 LLM 判卷。准确率与性能目标见方案第11节，不得为通过而静默降低门槛。

## 10. 完成定义与交付报告

完成一个开发任务前确认：

- [ ] 实现符合本次范围、公共契约和安全不变量。
- [ ] 相关单元/合约/集成/E2E/数学测试已运行并记录真实结果。
- [ ] lint/typecheck/build 按影响范围执行；未执行项有具体原因。
- [ ] 无凭据泄露、跨租户访问、无界任务和资源泄漏。
- [ ] 配置、迁移、文档与实际命令一致，依赖 lockfile 已同步。
- [ ] 没有以 mock、跳过断言、固定答案冒充真实能力。
- [ ] 列出剩余风险与未验证项，未擅自更改验收目标。

最终报告简明写明：修改了什么和文件路径；实际测试命令/结果；未完成或受阻项；必要的下一步。不能把“写了测试”等同“测试通过”，不能把“核实 main 文档”等同“锁定版本真实集成通过”。

纯文档任务只进行文档一致性检查并说明没有应用测试，不为凑流程生成假代码或执行不存在的构建命令。


> 2026-09-21 用户授权批量解题及付费测试：连续速拍、本地3并发独立核验、拍摄序号与原题号分离、单独/批量历史分类，详见 [ADR 0018](docs/adr/0018-batch-solving.md)。单题手动校验默认保持；重启不自动重放。
~~~~
