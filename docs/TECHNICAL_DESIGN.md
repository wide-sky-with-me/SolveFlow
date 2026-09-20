# SolveFlow 技术方案

> 2026-09-18 更新：设备思考设置改为两级（服务默认/关闭/开启，开启后选强度，参数协议单独选择）；知识点与详细步骤一样按需生成（focus.kind=knowledge-list），详细步骤/校验/知识点三类按需请求可并发（上限 3）。见 [ADR 0016](adr/0016-thinking-control-and-on-demand-concurrency.md)。

> 2026-09-17 最新用户授权：本地 App/Web 首轮输出简洁答案与加粗核心结果，详细步骤按需生成；校验默认关闭，生成后点击“校验”按钮才执行。下文强制自动校验只适用于保留的旧服务端路径。见 [ADR 0015](adr/0015-on-demand-answer-details.md)。

> 2026-09-17 阅读增量：本地主题默认跟随系统并实时同步，答案/步骤复用同一图形，追问/澄清复用安全公式渲染，Skill 扩展到学科大类。题目、模型与预算契约不变，见[主题与方法验收](READING_THEME_SKILLS_ACCEPTANCE.md)。

> 2026-09-17：Android 本地解题新增有时限的前台服务与原生阶段计时，正常息屏/切后台不再主动取消。Pi 循环、独立校验及 120 秒总预算不变；进程被杀不重放任务。诊断仅保存脱敏元数据，JSON 结构错误共享现有一次格式修复额度。见 [ADR 0014](adr/0014-android-background-solving.md) 与[实际验收](BACKGROUND_SOLVE_ACCEPTANCE.md)。

> 2026-09-15最新用户授权：手机直连模型、完整迁移本地应用，见[ADR 0013](adr/0013-local-device-agent.md)。默认RN App/Web使用本地Pi核心、SQLite/IndexedDB及设备模型设置；下文服务端专属架构和API密钥仅服务端规则只适用于保留的旧服务路径。新路径密钥由用户在设备设置中输入，安卓安全存储、Web仅内存；不打包服务器.env。Pi导入仍仅允许packages/agent/src/pi/，不重写Agent循环。iOS原生构建暂停。

> 2026-09-15客户端架构变更：用户授权Android、iOS与Web统一React Native/Expo。默认Web入口已迁移至apps/mobile，接口增加隔离的原生Bearer身份及只读提交恢复查询；公式/图文采用本地Expo DOM组件。见[ADR 0012](adr/0012-react-native-universal-client.md)。旧Next实现和专用依赖已清理；PWA安装/离线仍为待实施项。当前命令和验收以[RN迁移记录](REACT_NATIVE_ACCEPTANCE.md)为准。

> 状态：v0.3 本地M1数据库/私有上传/API/移动Web最小纵切已验收，清晰代数题真实网页Solver/Verifier PASS（见docs/M1_LIVE_ACCEPTANCE.md），公网验收未完成；M0整体安全验收仍在进行。实际实施进度见 AGENTS.md、docs/IMPLEMENTATION_PLAN.md 和 docs/PI_COMPATIBILITY.md；下文目录/接口仍为目标设计，不表示全部存在。
> 定位：基于 Pi SDK 的拍照做题 Agent；不 Fork 魔改 Pi、不自建 Agent loop、首版不上 RAG。
> 开发执行规范见根目录 AGENTS.md；它不是学生端运行时提示词。
> 最新模型决定：供应商、endpoint、模型引用、容量/报价/兼容参数由服务端环境配置，Solver与Verifier可分别设置，不硬编码厂商或型号；独立校验、无自动回退。见docs/MODEL_SELECTION.md与ADR 0002。

## 1. 产品目标与范围

核心链路：拍照/相册上传 → 裁切单题 → 补充说明 → 多模态解题 → 独立校验 → 答案卡片 → 同题追问。

目标是准确理解题目，提供可检查的答案与教学步骤，而不是把 Coding Agent 聊天窗口交给学生。首版重点验收初高中数学；物理、化学、生物已补充受审课程方法Skill，英语仍为策略扩展位，不承诺初期达到同等准确率，见[课程Skill验收](COURSE_SKILLS_ACCEPTANCE.md)。

本地可用性增量：已加入上传前矩形裁切、原图放大、题干更正、新旧答案连续展示和按题/步追问；公共契约与持久化兼容方案见 [ADR 0008](adr/0008-learning-continuity.md)。

追问展示按题组织：每题框内保留原解答、后续问答/澄清、进度/失败及输入框，再次追问沿既有来源回到原题；服务端同样按题筛选历史，见 [ADR 0009](adr/0009-question-conversations.md)。

### MVP 必须具备

- React Native/Expo统一Android、iOS和Web；相机和相册选择均可用，拒绝相机权限后仍可上传。
- 每次一张图片；单题或用户明确指定最多4题，不默默任选。多题按questions分组，题内展示教学步骤、图示与结论；未指定范围或条件不清时澄清。见ADR 0006。
- 2026-09-17：当前照片按题横向分页，顶部题号快捷跳转；用户约定左滑上一题、右滑下一题，追问和阅读状态留在各题中。补充记录独立查看；规整坐标刻度和标签避让由客户端统一处理，见[分页与绘图验收](QUESTION_PAGER_FIGURE_ACCEPTANCE.md)。
- 图片直接进入支持 image input 和 tool calling 的模型，独立 OCR 不是必经链路。
- 题干理解、缺失条件澄清、答案、关键步骤、知识点、引用和不确定性。
- Pi SDK 驱动工具调用；保留 Skill 所需的受限 read，按需启用辅助工具，提供 web_search、calculate、python_math 三类核心业务工具及获准的 MCP 工具。
- Solver → Verifier → 最多一次修正 → 再验证的有界流程。
- SSE 阶段进度、取消、断线恢复、同题追问、所有权检查和限流。
- PostgreSQL 保存业务状态，私有 S3 兼容存储保存图像；本地使用 MinIO。
- 无真实凭据也能运行的 fake provider、自动化测试与小型标注评测集。

python_math 在隔离验收前不得注册，开发早期可先启用另外两个工具。搜索未配置时禁用并说明能力受限，不伪造结果。公开发布时，已宣称提供的工具必须通过对应验收。

### 首版不做

题库/RAG、知识画像、整卷批改、手写轨迹、教师后台、支付、自动模型路由、多 Agent 群聊、开放插件市场、任意 Python 执行、离线大模型。PWA 可安装不等于离线解题。

## 2. 技术选型与架构

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 前端 | React Native + Expo + React Native Web + TypeScript | 三端共享UI，不承载Pi运行时 |
| 样式 | RN StyleSheet + 局部答案CSS | 移动优先、可访问性 |
| 图片 | 原生Expo Camera/ImagePicker/ImageManipulator；Web受控相机/Canvas适配 | 裁切、旋转、重拍与权限降级 |
| 公式/内容 | 本地Expo DOM组件 + 受控Markdown/KaTeX/SVG | 原生局部WebView、Web直接渲染；禁原始HTML，trust=false |
| PWA（待实施） | Manifest + 最小 Service Worker | 只缓存公共静态壳，不缓存私有内容 |
| API/Worker | Node.js LTS + Hono | 常驻进程，API 与 worker 分入口 |
| Agent | @earendil-works/pi-coding-agent | SDK、分级工具、原生 Skill、session、streaming |
| MCP | 服务端 MCP client + Pi Extension 桥接 | 按 server/tool 授权，不假设 Pi 内置 MCP |
| 模型 | @earendil-works/pi-ai | 首版一个可配置主模型，独立 Verifier 配置 |
| 契约 | Zod + JSON Schema 适配 | 运行时校验，Pi 工具 schema 在适配层转换/核对 |
| 数据库 | PostgreSQL + Drizzle | 真相源、迁移、租约任务、持久事件 |
| 图片存储 | S3/R2，开发 MinIO | 私有 bucket、同源鉴权预览 |
| 搜索 | SearchProvider 接口，首实现 Tavily | 后续可替换 Brave/Serper |
| 数学 | 受限 AST 计算器 + Python/SymPy 隔离 worker | NumPy 按需增加 |
| 测试 | Vitest + Playwright + pytest | 合约、集成、E2E、安全与数学回归 |
| 工程 | pnpm workspace | 初始化时固定 Node/pnpm 版本 |

不同时引入 Hono 和 Fastify。首版使用 PostgreSQL 任务表与事件表，不为“Pi Session + Redis”额外引入 Redis；扩容时可增加 Redis 通知/缓存，但不能替代业务持久层。

~~~text
RN Web → 固定同源代理 /api/v1 → Hono API
RN Android/iOS → HTTPS Bearer /api/v1 ↗
                                      ├─ 身份/所有权/上传/限流
                                      ├─ PostgreSQL：sessions/runs/events/results
                                      ├─ S3：私有题图
                                      └─ Worker：业务编排
                                           ├─ SolverAdapter → Pi SDK → pi-ai → VLM
                                           │    ├─ web_search → SearchProvider
                                           │    ├─ calculate → 受限 AST
                                           │    ├─ python_math → 隔离计算服务
                                           │    ├─ read / 可选辅助工具 → 受限 Skill 文件系统
                                           │    └─ mcp__server__tool → MCP Bridge → 获准服务
                                           └─ VerifierAdapter → pi-ai 独立调用
~~~

API 与 worker 来自同一应用包，以不同入口运行。使用常驻 Node 容器，不依赖短时 serverless 承载 Agent 生命周期。反向代理关闭 SSE 缓冲并配置足够的空闲超时。生产使用同源路由，减少 Cookie/CORS 复杂度。

## 3. Pi 接入与兼容性

### 3.1 已核实能力和版本风险

本次核实依据为官方 earendil-works/pi 的 main 文档，不以第三方镜像或旧代码片段作为版本契约。main 可变，也不一定等于 npm 已发布版本。

已确认：

- createAgentSession() 可嵌入服务；SessionManager.inMemory() 提供运行内状态。
- session.prompt(text, { images }) 支持图片；subscribe() 提供事件；abort()/dispose() 管理取消与清理。
- SDK 提供工具选择与禁用选项；本项目不采用一刀切禁用内置工具，而是显式选择并约束 read 等所需能力。具体 tools/noTools/excludeTools 语义以锁定版本探针为准。
- ResourceLoader 管理扩展、Skill、模板与上下文文件，默认自动发现不能直接用于多租户生产。
- .pi/SYSTEM.md 可替换默认提示；SDK 支持 ResourceLoader systemPromptOverride。
- 默认 Skill 按需加载依赖 read，没有时可能用 bash；因此首版保留受限 read，而非强制改为服务端预加载。
- 官方 README 明确说明核心不内置 MCP，可通过扩展增加支持；MCP client 连接/启动服务不等于模型必须拥有 bash。

M0 已核实发布版 pi-ai 0.85.1 的 ImageContent 使用下列平铺结构；它与先前 main 文档示例不同（类型证据见 PI_COMPATIBILITY.md，运行探针仍待验证）：

~~~ts
await session.prompt("请解决这道题", {
  images: [{
    type: "image",
    data: base64Image,
    mimeType: "image/jpeg",
  }],
});
~~~

图片结构以锁定发布版类型为准，禁止凭记忆判定平铺或 source 格式。M0 已固定0.85.1并生成lockfile，docs/PI_COMPATIBILITY.md 已创建，继续记录工具配置与运行探针结果。禁止 latest、版本范围漂移及 as any 掩盖不兼容。

### 3.2 适配层

只有 packages/agent/src/pi/ 可直接导入 Pi 包、处理 Pi 原生类型和事件。业务层依赖项目自有 SolverAdapter/VerifierAdapter、SolveInput、RunContext 和 SolverEvent，不依赖 Pi RPC 或 JSONL 格式。

RunContext 携带服务端确认的 owner/session/run、取消信号、预算与资源版本。模型参数不能决定租户身份或权限。Pi 管模型—工具循环；项目只管状态机、预算、独立验证、有限修正、持久化和对外事件，不另写 Agent loop。

### 3.3 分级工具权限与运行时资源隔离

原则从“砍掉所有 Coding 工具”改为“保留正常工作所需能力，限制资源和副作用”。工具名称不是权限边界，cwd 也不是沙箱。

| 类别 | 默认策略 | 强制边界 |
| --- | --- | --- |
| read | 启用，兼容 Pi Skill 加载语义 | 仅受审 Skill 的 SKILL.md、references/assets 文本及明确授权的 run 文件 |
| ls/find/grep | 按 Skill 依赖按需启用 | 与 read 相同根目录/租户限制，限深度、结果和耗时 |
| bash/powershell | 默认关闭；确需脚本的 Skill 单独审批 | 仅隔离执行配置，不授予宿主 shell；结构化受控脚本工具优先 |
| write/edit | 默认关闭；确需文件产物时按任务启用 | 只写当前 run 临时目录，不能改 Skill、配置或宿主项目 |
| 三类核心业务工具 | 按配置与验收启用 | 维持第5节专用工具限制 |
| MCP tools | 按 server+tool 显式批准 | MCP 桥接授权、schema、数据外发与副作用策略 |

默认 Solver 工具集为受限 read + 已配置业务工具 + 获准 MCP 工具，不是“全部默认工具开启”，也不再硬编码总共三个工具。Verifier 仍采用第4.3节无工具配置。

受限 read 优先复用锁定版本 SDK 的执行适配能力；若不能约束底层文件访问，使用保持 read 名称/schema/结果语义的受控实现并测试 Skill 兼容性。只能注册一个有效 read 实现，禁止未受限内置实现与同名包装器同时存在。仅传 cwd、仅检查路径字符串前缀或仅在提示词里规定目录均不够。

- 使用受控 ResourceLoader 保留 Pi Skill 目录发现、描述注入和按需读取流程，但仅在明确配置的受审资源根内发现。禁止扫描开发 cwd/HOME/父目录、开发 AGENTS/CLAUDE、任意 npm 扩展或用户上传目录。
- Skill 根只读，run 临时根独立且绑定 owner/run。访问必须规范化路径、验证根边界、阻止符号链接/路径穿越/竞态逃逸，并用只读挂载或文件系统代理加强隔离。拒绝环境文件、凭据、设备文件与其他租户数据。
- read/ls/find/grep 共享路径策略；读取大小/分页与总输出受限，不能借搜索工具绕过 read。Skill 文件本身不含秘密。
- 扩展初始化具有代码执行能力，扩展代码/依赖/版本必须审查；工具调用钩子不能替代扩展隔离和底层授权。
- 每 run 固定能力清单（工具名、实现/来源、权限配置、schema 哈希），注册后断言一致；未知工具或权限扩大失败关闭。共享进程不得按某租户请求全局放宽工具。
- 通用斜杠命令、模板和文件展开仍关闭；Skill 显式选择走独立白名单入口，仅允许映射到已安装 Skill，不能执行任意扩展命令。
- 根目录 AGENTS.md 仅给开发 AI，学生端仍使用 packages/agent/resources/SYSTEM.md。

### 3.4 原生 Skill 按需加载

首版保留 Pi 的渐进式加载：启动时注入获准 Skill 的 name/description，模型按题型调用受限 read 加载 SKILL.md，再读取必要的相对路径参考资料。科目由模型根据原题自动识别，旧会话学科仅作可纠正提示，不限制只能用一份策略；允许同题组合多个获准 Skill。不再以服务端预加载单一学科替代默认流程。

初期 Skill 名称为 general、math、physics、chemistry、english。Skill 是方法论，不是题库。使用标准 frontmatter，资源注册记录版本、内容哈希、读取根和所需工具/MCP 映射。若某 Skill 必须依赖未授权/不可用工具，不向模型宣称完整可用；可提供明确标注的纯文本降级策略，不静默加载后才无限失败。

Skill 正文和依赖不能自行授予权限。含 scripts 的 Skill 必须单独审查脚本与依赖，优先封装结构化工具；确需 bash 的场景选择已验收的隔离执行配置，禁止模型安装依赖、启动任意服务或在宿主执行命令。脚本所需网络/文件权限逐项批准；SKILL.md 的 allowed-tools 字段不能替代后端授权。

为兼顾及时调用与上下文成本：资源元数据启动时加载，正文按需读取；不可变资源可按内容哈希缓存，但每次访问仍鉴权。记录已加载 Skill 与引用资源；设置加载次数/输出预算，加载失败返回明确错误。对固定题型验证“先读策略再调用所需工具”，不把模型一定会自动加载当保证；关键策略可由服务端显式白名单加载作为补充/失败降级，而不是唯一机制。

### 3.5 MCP 接入与生命周期

采用服务端 MCP client，经 Pi Extension 注册为普通模型可调用工具，不要求开放 bash。M0 选择并锁定实际 MCP SDK/桥接实现版本与许可，验证 tools/list、tools/call、schema 和错误转换；不凭空假设 Pi 有原生 MCP API。先覆盖 Streamable HTTP 与 stdio；其他传输后续按需接入。

- 连接配置由管理员提供，固定 server ID、endpoint 或可执行文件/参数、最小环境和凭据引用。学生/模型不能提交任意 URL、command、args 或修改服务器配置。
- stdio 由服务端进程管理器启动固定程序，限制环境、权限、工作目录和资源，不经模型 bash；不得继承全部宿主环境，不允许运行时 npx latest。HTTP 限定批准地址/TLS/出口；阻止私网与重定向绕过，内部服务仅按显式部署白名单例外放行。
- 初始化后 tools/list 仅作为发现，不自动全部授权。按 server+tool 白名单过滤并记录 schema 哈希；以 mcp__server__tool 稳定命名，检测清洗后重名/长度限制，禁止覆盖 read、业务工具或其他 server 工具。
- MCP schema 转换不支持的约束应明确拒绝或补充本地验证，不能静默丢弃。结果 content/isError、超时、取消和过大输出统一映射；资源链接不能自动抓取，prompts/resources/sampling/elicitation 等非工具能力首版不自动开放。
- MCP 的 readOnlyHint 等注解仅作参考，不是安全证明。逐工具审核实际副作用和外发数据。首版只自动调用获准的只读/搜索/计算工具；写入、发送、删除等能力在存在服务端审批/用户确认机制前不注册。
- 使用服务端绑定的 owner/run 身份与最小凭据；共享连接仅适用于无用户状态且权限一致的服务。有用户令牌/状态的连接按身份隔离，不能让模型参数覆盖身份，也不传递模型供应商密钥。
- 启动预热必要连接和获准 schema，避免每题重启 MCP；单 run 固定能力快照，列表/权限变更仅在后续 run 经重新审批生效。凭据撤销例外：立即拒绝后续调用并尽力取消活动调用。
- 每次调用受鉴权、限流、总预算、超时、AbortSignal 和脱敏审计约束。取消尽力传播至 MCP；远端不保证停止，迟到结果丢弃且不能伪称回滚副作用。无界重连/自动重试禁止。
- MCP 断连时标记能力不可用；可选服务不阻塞其余解题，必要服务不就绪则明确降级/失败。共享连接引用计数管理，run 清理不误关其他会话连接；服务退出关闭连接并回收本服务启动的 stdio 子进程。

同一能力同时有业务工具和 MCP 实现时只暴露一个入口，或明确各自用途，避免模型重复调用。将 MCP 搜索计入搜索配额，不能通过别名绕过限制。

## 4. 解题、校验与结果契约

### 4.1 状态机

~~~text
queued → understanding → solving → verifying → completed
              │             │          ├─ revising → verifying → completed
              └─────────────┴──────────┴─ needs_clarification
任意非终态 → failed / cancelled
~~~

completed、needs_clarification、failed、cancelled 为终态。只有首次验证 FAIL 才进入 revising，最多一次修正。再次 FAIL/UNKNOWN 可交付有效候选，但必须标 unverified。图像或条件不足时返回澄清，不补猜。

### 4.2 Solver 规范

1. 阅读原图和补充说明，保留题干、选项、单位、图形标注与目标。
2. 不凭视觉比例推断长度，不补全看不清的符号；多题范围未指定、超过4题或必要条件缺失时要求澄清。
3. 最新事实、时政或不确定事实才搜索；普通代数不默认搜索。
4. 数值/符号结论优先用数学工具检查，保留定义域和单位。
5. 输出结构化候选、面向学生的关键教学步骤、知识点与证据引用。
6. 不请求、不存储、不展示模型内部思维链；教学步骤是可公开的解答说明。

### 4.3 独立 Verifier

由业务编排器强制调用，不做 Solver 可以跳过的 verify_answer 工具。通过 pi-ai 使用独立 SYSTEM 和上下文；可配置不同模型，但独立调用不能保证消除共同偏差，也不默认便宜模型能验证难题。

输入包括原图、用户问题/约束、识别题干、候选答案和教学步骤、受控工具证据与引用。视觉题必须检查原图，不能只看 Solver 转述；不支持 image 的 Verifier 不得将视觉题标为核验通过。

~~~ts
type Verification = {
  verdict: "pass" | "fail" | "unknown";
  issues: Array<{ code: string; stepId?: string; message: string }>;
  checked: Array<"transcription" | "logic" | "arithmetic" | "units" | "domain" | "citations">;
};
~~~

输出必须通过 JSON schema 校验。检查原题一致性、运算、符号、单位、定义域与引用支持关系，不以“看起来合理”替代检查。Verifier 首版不调用工具，若需新数学证据通过 issue 退回 Solver。

FAIL：携带 issue 最多修正一次并再验证。UNKNOWN：标未充分验证，不无限重试。超时/拒绝/schema 错误都不是 PASS。已有有效候选时验证不可用可降级 unverified；候选也无效则 failed。UI 写“模型校验通过”，不写“保证正确”。

### 4.4 结果结构

当前v1增加可选questions数组（2–4项）：`{ number, answer, stepIds, figureIds }`。steps/figures仍全局存储、ID唯一，questions必须将每个步骤/图恰好分配一次；Verifier引用原ID。新多题输出必须填写questions，旧记录兼容读取；不修改历史答案或已存校验状态。UI只在题号、答案、步骤和图示归属均明确时为旧记录生成分题视图，歧义时保留原文。该扩展无数据库列变更，服务端先升级、Web同步构建；旧客户端不认识questions，发布时需刷新。

packages/contracts 定义 Zod schema 并导出 TS 类型。以下为语义结构，实现必须补充长度与跨字段约束：

~~~ts
type SolveResult = {
  schemaVersion: 1;
  kind: "answer" | "clarification";
  problem: { text: string; subject: string; uncertainties: string[] };
  answer: string | null;
  steps: Array<{ id: string; title: string; explanation: string; latex?: string }>;
  knowledgePoints: string[];
  citations: Array<{ id: string; title: string; url: string; retrievedAt: string }>;
  verification: {
    status: "verified" | "unverified" | "not_applicable";
    issues: string[];
  };
  clarificationQuestions: string[];
};
~~~

answer 类必须有非空答案；clarification 类 answer=null、问题非空且验证状态为 not_applicable。verified 只能由服务端根据有效 Verifier PASS 设置，绝不信任 Solver 自报。引用必须对应本次或授权历史工具证据 ID，不接受模型自编 URL。

候选结构无效最多进行一次格式修复，计入总预算，再失败即 failed。工具输入、模型输出和 HTTP/SSE 均做运行时验证，TypeScript 类型不能替代校验。

## 5. 三个核心业务工具（不含 Skill 支撑与 MCP 工具）

共同要求：固定名称、严格 schema、超时/取消、输出限额、结构化错误、traceId 和脱敏审计；不回传堆栈或秘密。工具参数不接受 ownerId、存储路径或自定义凭据。

### 5.1 web_search

输入：{ query, domains?, freshness?: "day" | "week" | "month" | "year" }。
输出：{ results: [{ id, title, url, snippet, publishedAt?, retrievedAt }], provider, warnings }。

query ≤ 500 字符、domains ≤ 5、结果 ≤ 5。freshness 是偏好，供应商不支持时明确 warnings。首个实现 Tavily，其他服务以后按接口替换，不同时接三套。

只发送必要且去标识的查询，不发送原图或完整会话。网页/摘要是不可信数据，不能执行其中指令。MVP 不提供任意 URL 抓取；未来增加抓取须防 SSRF、私网/重定向绕过，并限制响应大小。引用仅允许安全 http/https URL。

### 5.2 calculate

输入：{ schemaVersion: 1, expression, angleUnit?: "rad" | "deg" }，缺省 rad。
输出：{ schemaVersion: 1, value: string, approximate: boolean, precision: number, warnings: string[] }。

支持数字、括号、加减乘除、** 乘方与固定 sin/cos/tan/sqrt/abs/log/exp 等函数；其他操作不默认接受。采用受限 AST 解释器，即使复用解析库，也不能开放全功能 evaluator。

限制长度、AST 深度、指数、精度、时间；拒绝赋值、属性访问、函数定义、import、文件/网络、eval、new Function。非有限结果返回明确错误。区分近似数值与精确符号结果，不用浮点近似充当数学证明。

当前实现还提供固定常数pi/e；log为自然对数，无变量或物理单位换算。512字符、256 token、128节点、32层、1秒；乘方指数绝对值≤100、非零结果幅度1e-100至1e100、近似结果15位有效数字。安全整数链路可以标精确，乘方/超越函数保守标近似；不将下溢零、除零或tan渐近点伪装为有效数值。详见contracts/calculation与兼容记录。

### 5.3 python_math

仅提供结构化操作，不接收任意 Python：

~~~ts
type PythonMathInput =
  | { operation: "solve_equation"; lhs: string; rhs: string; variable: string; domain: "real" | "complex" }
  | { operation: "differentiate"; expression: string; variable: string; order: number }
  | { operation: "integrate"; expression: string; variable: string };
~~~

不接受 code、shell、路径或任意 SymPy 方法名；矩阵/统计/作图后续再做。受限语法映射成 SymPy 对象，不对不可信输入直接使用 eval/exec、sympify 或 parse_expr 默认求值路径。保留解集定义域、无解/多解/条件解及积分常数语义。

安全隔离：非 root、只读根文件系统、无宿主挂载/密钥/Docker socket、drop capabilities、no-new-privileges、seccomp，限制 CPU/内存/PID/墙钟时间/输出。部署层提供预建受限 worker 池，应用不得挂 Docker socket。每请求可强杀的计算子进程无网络权限；服务仅接受内部鉴权且容器 egress deny。隔离必须实测，不能只写“运行在容器”就认为安全。

## 6. API 与 SSE

同源 /api/v1，服务端 Secure/HttpOnly/SameSite Cookie。开发可用签名匿名身份，但匿名也要有不可伪造 owner。公网发布必须有身份、配额/风控和隐私说明。写操作校验 Origin/CSRF，所有资源访问校验 owner，不把 ID 随机性当授权。

| 方法/路径 | 用途 |
| --- | --- |
| POST /uploads | multipart 单图上传，返回 uploadId 和授权预览信息 |
| DELETE /uploads/:uploadId | 删除未绑定上传；已绑定则返回冲突 |
| POST /sessions | 创建一道题的会话 |
| POST /sessions/:sessionId/runs | { uploadId?, message, subject? }；首轮必须有图，追问复用原图 |
| GET /runs/:runId | 状态/最终结果快照 |
| GET /runs/:runId/events | SSE，支持 Last-Event-ID |
| POST /runs/:runId/cancel | 幂等取消 |
| GET /sessions/:sessionId | 授权历史、题图与结果 |
| DELETE /sessions/:sessionId | 禁止后续访问并清理图像/业务数据/快照 |

创建 run 的 Idempotency-Key 按 owner+session+key 隔离，保存 24 小时；同 key 同参数返回原 run，不同参数 409。单 session 最多一个非终态 run，用数据库约束/事务保证；并行追问返回 409。更换题图新建 session，不混淆题目。

POST 创建任务返回 202+runId，再 GET EventSource；不能假设原生 EventSource 支持 POST body。

~~~text
id: 17
event: run.status
data: {"schemaVersion":1,"runId":"...","seq":17,"status":"verifying"}

id: 18
event: answer.final
data: {"schemaVersion":1,"runId":"...","seq":18,"result":{...}}
~~~

事件：run.status、tool.status（安全摘要）、answer.final、run.error、run.done。seq 在单 run 内单调递增，前端按 runId+seq 去重。首版不透传候选正文 token 或 thinking_delta，仅流式展示阶段/工具状态，验证后一次交付最终答案。后续正文流式预览需另设计 draft/replace 协议及未验证标记。

事件持久化后发布；终态、结果、final/done 事件同事务提交。数据库是真相源，SSE 只是传输视图。首版可按有界间隔批读事件，不必上消息总线。每 15 秒发送注释心跳，设置连接数、事件速率和缓冲上限。

断线不取消，刷新从 Last-Event-ID 续传；只有显式取消才停止。事件保存 24 小时，过期游标在建立流前返回 410 并引导 GET run 恢复快照；不能自动重做付费解题。终态重连重放剩余事件后关闭。

HTTP 错误：{ error: { code, message, retryable, traceId } }。400 参数错误、401 未认证、403 禁止、404 不存在/不可见、409 冲突、413 超限、415 不支持、429 限流、503 暂不可用。已建立 SSE 的错误通过 run.error 发送，不输出上游原始异常。

## 7. 图片、数据与会话

### 7.1 图片处理

- input accept=image/*、capture=environment 仅是入口提示，不保证浏览器打开相机；MediaDevices 需 HTTPS/localhost，始终保留上传 fallback。
- 客户端裁切/旋转/压缩/预览，服务端重新解码验证，不相信 MIME/扩展名。
- 初值：单图 ≤ 10 MiB、解码 ≤ 20MP；规范化 JPEG/PNG/WebP，长边 ≤ 2048px、输出 ≤ 4 MiB。细字看不清时要求局部重拍，不继续过度压缩。
- 去 EXIF/GPS，拒绝 SVG/动画/伪造格式；HEIC 首版提示转 JPEG，不承诺自动转换。
- 正式入库前校验；不接受任意远程图片 URL。服务端根据受权 objectKey 读取并构造 Pi image content。
- 私有 bucket，预览使用同源owner鉴权接口，内部S3签名读取；浏览器不拿签名URL。该本地M1细化见docs/adr/0001-local-m1.md。不在日志、模型文本、analytics中记录base64或签名URL。

### 7.2 最小数据实体

| 实体 | 核心信息/约束 |
| --- | --- |
| owners | id、身份类型、配额；匿名也隔离 |
| uploads | ownerId、objectKey、mime、bytes、hash、expiresAt、状态 |
| sessions | ownerId、uploadId、subject、createdAt、deletedAt |
| runs | sessionId、ownerId、status、leaseOwner/leaseExpiresAt、attempt、幂等键、inputHash、预算、错误码 |
| messages | sessionId、runId、role、用户文本/最终答案引用；无内部思维链 |
| results | runId 唯一、schemaVersion、SolveResult、验证摘要 |
| run_events | runId+seq 唯一、type、payload、createdAt |
| tool_calls | runId、toolName、耗时、状态、脱敏证据 |
| runtime_snapshots | 后续确需时增加；SDK/schema 版本、受控加密快照、expiresAt |

记录实际 provider/model ID、SDK、prompt/Skill 版本、token usage 和成本估算。未返回用量标 unknown，不能记 0。Pi sessionId 不作授权凭证或业务主键。

### 7.3 生命周期与恢复

MVP 每个 run 创建独立内存 Pi session，输入原题图、授权历史追问与最终答案；单题最多 10 轮。失败/取消候选不混入后续历史。业务历史可以重建追问上下文，但不承诺恢复 token 级执行，也不假定 Pi 原生支持 Redis。

若后续保存 Pi 原生状态，必须通过锁定版本官方导出/导入接口与兼容测试，不能自行拼 JSONL 或跨版本强行回放。

Worker 使用 PostgreSQL 租约和心跳；进程崩溃、租约过期后将遗留活动 run 置 failed/WORKER_LOST，不自动重放可能已计费调用。用户显式重试创建新 run。终态与事件通过事务/CAS 阻止旧 worker 迟到写入。

取消写入持久标记并传播 AbortSignal；晚到答案不能覆盖 cancelled。finally 中取消子任务、退订、清理句柄并 dispose session；前端断线与用户取消分开处理。

### 7.4 保留与隐私

默认保留：未绑定上传 24 小时；题图/对话/结果 30 天；SSE 事件 24 小时；脱敏指标 30 天，均可配置。清理对象、快照和关联记录；失败可重试并告警。删会话先取消 run、禁止读取，再异步清理；备份删除延迟须写入隐私说明。

学生图片/聊天不默认用于训练或评测。评测用合成、许可公开或明确授权并脱敏的数据。上线前确认地区要求、未成年人/监护人同意、供应商数据留存与删除链路。

## 8. 安全、预算与失败

下列为初始可配置限制，不是已验证性能承诺；变更须同步测试与文档。

| 项目 | 初值 |
| --- | --- |
| run 总墙钟时间 | 120 秒，含验证/修正/格式修复 |
| Solver 模型轮数 | 16 次，含工具后续调用、格式修复与修正；与 Verifier 最多 2 次合计 18 次模型派发，见 [ADR 0011](adr/0011-solver-round-budget.md) |
| 工具总调用数 | 16 次；read/ls/find/grep 共最多8次，业务/MCP/脚本/写入共最多8次；所有搜索入口合计最多2次 |
| 搜索 / calculate / python_math | 每次 10 秒 / 1 秒 / 5 秒 |
| Skill 文件工具 / MCP | 每次2秒 / 默认10秒；均受120秒总预算限制 |
| Verifier | 每次 ≤ 20 秒，最多 2 次 |
| 工具输出 | 每次 ≤ 32 KiB，结构化截断 |
| 数学子进程 | 1 CPU、256 MiB、32 PID，需部署实测 |
| owner 限制 | 同时 2 个活动 run，每分钟创建最多 6 个 |
| 会话历史 | 最多 10 轮 |
| 单次模型输出 | 初始 4096 tokens；供应商独立 reasoning 预算另配 |

部署前必须配置 per-run/每日 token 和费用上限、全局并发与 reasoning budget。价格未知时依靠 token/调用数限制，不能声称精确费用硬限制。SDK 与业务重试统一管理，不得叠加越过预算。仅在未产生输出且可重试的网络错误上最多重试 1 次，尊重 Retry-After 且计入总时限；无法即时取消的供应商调用记录迟到成本。

安全底线：

2026-09-14用途限制：Agent仅用于允许范围内的学习解题；允许中立政治/历史/安全教育课程题，拒绝政治动员、立场宣传与危险请求，不按学科关键词误拒。Solver/Verifier固定共用CONTENT_POLICY，clarification可带refusalReason；Verifier的POLICY_VIOLATION不进入未验证降级，服务端丢弃候选并返回固定安全提示。见[ADR 0007](adr/0007-solving-content-policy.md)。

- 凭据仅服务端环境/secret manager；不放 NEXT_PUBLIC_*，不让学生提交 key。
- 工具分级开放而非全部禁用：read 受限启用，辅助工具按依赖授权，脚本/写入隔离且默认关闭，MCP 按 server/tool 批准；升级/恢复/不同 cwd/HOME 均验证权限边界。
- 用户文本、图片文字、搜索结果和工具输出不能改变系统策略、权限或执行代码。
- 模型不得决定 owner、存储路径、工具权限、任意请求目标或 verified 状态。
- Markdown 禁 raw HTML，链接协议白名单；KaTeX trust=false 并限制宏展开和内容大小。
- Service Worker 不缓存 /api、对话、图片、SSE、签名 URL；退出/删除清理本地敏感状态。
- 模型正文日志默认关闭，只留 trace/run、阶段、耗时、脱敏错误和用量。
- Prompt 防注入只是辅助，真正边界是服务端授权、schema、白名单和执行隔离。

## 9. 前端交互

2026-09-16按钮与题干编辑细化：重新解答位于题目卡片标题旁，主操作/辅助操作/危险操作统一蓝色/浅蓝/浅红按钮与按压反馈。题干更正保留TeX源码编辑，使用相同安全KaTeX/Markdown组件实时预览，提供公式/分数/根号/上下标插入，见[按钮与公式编辑验收](BUTTONS_TEX_ACCEPTANCE.md)。

2026-09-16等待状态细化：首次解题、重新解答与同题追问共用蓝白题纸扫描等待卡片，依据实际run状态显示识题/解答/核对，不展示推算百分比。修正仍处于核对阶段，完成/失败/取消移除动画；后台或系统减少动态效果时停用循环。保留取消，连接异常时展示刷新入口。见[等待动效验收](SOLVE_PROGRESS_ACCEPTANCE.md)。

2026-09-16用户确认的导航结构：底栏三个入口——题目（当前解答/历史题目分栏）、居中突出拍照、我的（模型设置/使用说明/本地记录入口）。去除顶部品牌栏；相机取消回到原页，切页保留题目与未发送追问。新图标与本地开屏动画见[导航和开屏验收](APP_NAVIGATION_ACCEPTANCE.md)，数据及Agent架构不变。

2026-09-16阅读细化：题目、答案、详细步骤、知识点使用独立卡片，步骤默认折叠，同题追问保留在该题下。开屏等待本地配置与题目恢复、当前答案图文布局或文字降级就绪后再淡出，见[卡片与启动验收](READING_CARDS_STARTUP_ACCEPTANCE.md)。

2026-09-16增加每题“重新解答”：追加新的整题解答并重新独立校验，保留旧版本；多题按原题范围隔离并沿用题干更正。上下文增加regenerate标识，个人页解释文案集中到使用说明，见[重新解答验收](REGENERATE_ACCEPTANCE.md)。

1. 首页：主操作“拍一道题”、次操作“从相册选择”，标明识别范围和隐私。
2. 题图确认：裁切/旋转/重拍，补充说明、自动识别科目，“开始解题”。
3. 会话页：原图/题干、阶段进度、最终答案卡片、教学步骤、知识点、引用、验证状态、追问框。

展示“读题/计算/搜索/校验”，不展示内部 thinking。澄清、取消、断网、限流、超时、未验证、相机拒绝均有独立可测试状态。运行中禁止同题重复提交；可保留文本草稿，不默认持久化敏感图像。支持键盘/屏幕阅读器、≥44px 触控目标、窄屏公式横向滚动和足够对比度。

## 10. 目录职责（部分已实现，详见M1验收记录）

~~~text
SolveFlow/
├── AGENTS.md
├── docs/
│   ├── TECHNICAL_DESIGN.md
│   ├── PI_COMPATIBILITY.md          # M0 创建
│   └── adr/
├── apps/
│   ├── mobile/                    # Expo/RN统一客户端，含局部DOM答案
│   └── api/                       # Hono 路由与 worker 入口
├── packages/
│   ├── contracts/                 # Zod 和公共协议
│   ├── client/                    # API/SSE/提交恢复与三端共享逻辑
│   ├── agent/
│   │   ├── src/pi/                # 唯一 Pi 导入边界
│   │   ├── src/orchestration/     # 状态机/预算/验证
│   │   ├── src/tools/             # 核心业务工具与受限文件/脚本适配
│   │   ├── src/mcp/               # MCP client、连接池、schema/结果转换
│   │   ├── src/policy/            # 工具能力清单、路径/副作用授权
│   │   └── resources/
│   │       ├── SYSTEM.md          # 学生端提示
│   │       ├── VERIFIER.md
│   │       └── skills/<name>/SKILL.md
│   ├── db/                        # Drizzle 与迁移
│   └── config/                    # 服务端配置校验
├── services/math/                 # SymPy 与 pytest
├── tests/evals/                   # 标注题与评分器
├── infra/                        # 容器/compose/部署
├── .env.example                  # 仅占位符
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
~~~

根目录不放自动发现的 .pi/SYSTEM.md，以免开发 Agent 误加载学生端提示。Pi 本地实验只能在隔离运行目录映射资源，不改变生产受控加载策略。

## 11. 里程碑与验收

### M0：SDK 与安全探针

初始化 workspace 与精确依赖版本，核实 engines、许可和来源；验证图片、受限 read、Skill 描述→正文→参考资料渐进加载、业务工具、stream、取消、dispose 与上下文重建。用本地测试 MCP 服务覆盖 stdio/Streamable HTTP 的发现、过滤、调用与取消，证明无需给模型开放 bash。证明开发 HOME/cwd/AGENTS、未批准命令和文件不会进入运行时。写 PI_COMPATIBILITY.md 与可重复命令。

验收：无凭据 fake 测试通过；一条显式 opt-in、限费的真实 VLM 图片测试通过。没有凭据时标记真实探针未验证，不凭假接口继续宣布 SDK 接通。

### M1：最小纵切

contracts → db/upload → Pi 适配 → calculate → Worker/Verifier → API/SSE → 上传/答案 UI。

验收：清晰代数题完整链路；fake provider 可确定性复现 PASS/FAIL/UNKNOWN/澄清；取消、失败、预算与身份隔离可测试。静态 mock 页面不算真实解题完成。

### M2：拍照与工具完善

裁切/相机 fallback、搜索引用、隔离 python_math、生产 MCP 工具接入/预热/断连降级、Skill 依赖校验、授权追问、SSE 恢复、存储清理。

验收：隔离逃逸防护、引用溯源、跨 owner 越权、断线、worker 崩溃、重复提交回归全部通过。

### M3：PWA、评测与发布

静态壳缓存、移动 E2E、部署说明、指标/告警、隐私和配额。建立 ≥60 题人工确认集：至少数学30、物理10、化学5、英语5、模糊/缺失/多题10。属于冒烟样本，不代表普遍学科能力。另设固定安全集：图片注入、恶意链接、表达式攻击、越权。

预设发布门槛：清晰可解初高中数学答案正确率 ≥90%；模糊/缺失/多题正确澄清率 ≥90%；固定安全回归越权执行/泄密为0；verified 结果100%可追溯验证，引用100%可追溯。统计 Verifier 误放行/误拒，不能只报 PASS 比例。符号题按数学等价、数值题按明确容差/单位，开放题人工复核，不能只靠另一 LLM 评分。

性能目标（需实测）：同区域无排队时，接受请求到首状态事件 p95 ≤2秒，普通清晰题最终结果 p95 ≤45秒。记录硬件、模型、并发与样本数；未达标如实报告，不修改门槛掩盖失败。

## 12. 测试与完成定义

- 单元：schema、状态机、预算、AST、引用过滤、prompt/Skill 版本。
- 适配器：图像形状、按配置生成的工具集、受控 Skill 发现与按需读取、禁止非授权资源/命令展开、事件映射、abort/dispose、锁定 SDK 兼容性。
- Skill/MCP：相对路径引用、符号链接/穿越/跨租户拦截、工具依赖缺失、MCP 未批准工具过滤/重名/schema变化、身份隔离、断连/取消/超时、共享连接清理、脚本配置隔离与不经模型 bash 启动 stdio。
- 集成：租约、同题并发、幂等、终态原子性、SSE 去重/续传/过期、图像所有权、删除与降级。
- Python：符号等价/定义域/积分常数、恶意表达式、资源耗尽、强杀、无网/无宿主访问。
- E2E：上传→裁切→解题→校验→追问，含拒绝相机、模糊、失败、断网和窄屏公式。
- 真实评测：显式 opt-in、限费和脱敏，普通 CI 不静默调用付费服务。

每个里程碑需要合约一致、相关测试通过、无秘密泄漏、启动可重复、文档更新，并列明未验证项。模型/SDK/prompt/Skill 变更必须跑相应回归，不凭演示宣称准确率提升。

## 13. 实施前待确认

M0：已发布 Pi/MCP SDK及桥接实现精确版本/许可证/Node engines、受限 read 适配方式。真实验证前：主模型和视觉 Verifier 可用 ID、服务端凭据、MCP server/tool 清单及权限。上线前：部署地区、数据保留、未成年人隐私、日费用上限。默认技术选型已给出，变更需说明理由，不把所有实现选择重新交给用户。

M0命令行实现与运行说明见 docs/M0_PROBE.md；当前公开报价、30元预算和保守预占依据见 docs/DMX_PRICING.md。命令行探针与M1应用入口独立；新增持久化/SSE/API身份与移动Web见docs/M1_ACCEPTANCE.md。

## 14. 官方依据

以下 main 链接为本次核实来源，实施以锁定版本对应文档/类型为准：

1. [Pi 官方资源与系统提示说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)
2. [SDK：session、图片、工具与 ResourceLoader](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
3. [工具配置示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/05-tools.ts)
4. [pi-ai：图像与模型接口](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)
5. [Skills：read/bash 加载机制](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)

未将第三方 pi-web 内部协议纳入项目契约，也未将 issue 或未核实模型名当作必须依赖。


### 2026-09-10 图文答案扩展

依据用户授权实现自动科目与图文渲染，见[ADR 0003](adr/0003-automatic-subject-rich-answers.md)。实际候选新增可选figures，独立Verifier必须核验图示才允许PASS；原图引用仅指向本题授权资源。新预算窗口的显式续额语义见[ADR 0004](adr/0004-explicit-budget-renewal.md)，不因更换型号或额度不足自动续额。

2026-09-14：已补齐Solver最终JSON语法失败时的全run最多一次格式修复，复用Pi原会话与图片，不重写Agent loop；同样计入轮数/取消/总时限/费用许可。结构或证据校验失败仍失败关闭。安全诊断与本次实际验收边界见[上传失败诊断](UPLOAD_FAILURE_2026-09-14.md)。

2026-09-14用户授权调整：累计费用限制默认关闭，缺省/unlimited对应内部null；正数才启用有限预算。旧30元上限、强制供应商硬额度确认和反复续额流程不再是默认要求。历史账本保留；模型/工具轮数及取消、超时保护继续执行。见[ADR 0005](adr/0005-optional-spending-limit.md)。


### 2026-09-14 题干与知识内容增量

按用户授权新增每题完整题干、授权原图局部裁片、可展开知识点及同题知识点追问；坐标图增加轴标签、不同单位轴比例、折线和填色区域，加入经济课程 Skill。协议为可选字段兼容扩展，不新增工具权限或数据库表；Agent复用已有Sharp处理坐标辅助图与实际裁片，见[ADR 0010](adr/0010-question-learning-content.md)。原题图与解答图均要求独立 diagram 核验，数值检查使用既有受限 calculate。


### 2026-09-15 学生端界面精简

按用户要求参考拍照搜题产品，统一白底与蓝色操作、单列阅读；移除重复说明和装饰，解题后整张原图可折叠，保留每题完整题干、局部图、分步解析、知识点和题内追问。模型、校验及存储协议不变，具体调整与验收见[界面精简记录](INTERFACE_STYLE_ACCEPTANCE.md)。

### 2026-09-15 H5 相机

拍摄入口补齐 `getUserMedia` 预览→拍摄→确认→裁切，默认后置优先、不请求麦克风，关闭/离开/迟到授权均释放流，保留原生相机与相册备用入口。手机实时预览要求HTTPS安全上下文；不改变上传/解题契约。详见[相机验收](CAMERA_ACCEPTANCE.md)。
