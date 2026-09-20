# Pi / MCP 兼容性记录

## 2026-09-18 启动遮罩卡死修复（0.1.29 → 0.1.30）

0.1.28 在真机上会停在“正在读取本地题目”遮罩后无法进入。原因：`knowledge-list` 是新增的按需请求类型，但“哪些 run 属于按需请求”这一判定仍有两处硬编码为 `['explanation','verification']`——`apps/mobile/src/app.tsx` 的启动就绪判定与 `packages/client/src/question-conversations.ts` 的续接目标。知识点 run 完成后被当成最新答案版本，界面却只渲染原答案面板，于是启动就绪永远等不到一个不会出现的面板。

修复：该判定上移到契约层（`packages/contracts/src/run-context.ts` 的 `AUXILIARY_CONTEXT_KINDS` / `isAuxiliaryContext`），四处引用统一改为调用它。同时发现 `packages/contracts/src/question-thread.ts` 里还有两处同类列举：题号解析改为 `"number" in reference`（自动覆盖所有带题号的上下文，不再手工枚举），来源必须 completed 的检查改用 `isAuxiliaryContext`。新增 `packages/client/src/question-conversations.test.ts` 回归，并在 `knowledge-on-demand.spec.ts` 增加“刷新后启动遮罩必须消失”的断言（此前只断言文本内容，遮罩覆盖时仍会通过）。0.1.30 / versionCode 31 覆盖安装后真机确认正常进入题目页，660 项离线测试通过。

## 2026-09-18 思考控制二级化、知识点按需与打包提速

0.1.28 把设备思考设置改为两级：一级为服务默认/关闭/开启，选开启后再选强度（低/中/高），参数协议单独选择（thinking.type、enable_thinking、reasoning_effort）。关闭与开启都通过已锁定的 Pi 0.85.1 兼容字段发送，不按型号或供应商写死；thinking.type 协议下低/中/高映射 low/high/max（DeepSeek 官方档位）。真实 DMX DeepSeek 探针确认关闭、开启·中、开启·低三种参数组合均被接受。

brief 不再输出知识点（knowledgePoints 与 knowledgeDetails 都为空），知识点改为与详细步骤相同的按需请求（focus.kind=knowledge-list，独立运行并缓存）；详细步骤、校验、知识点三类按需请求可并发（上限 3 个），准备与结果写入仍串行，避免并发覆盖本地记录。658 项离线测试（新增 7 项）、lint、typecheck 与 build 通过。

构建流程改为复用 Gradle daemon、并行 worker，并在 app.config.ts/plugins/assets 未变化时跳过 prebuild；新增 scripts/check-apk.mjs 自动完成签名连续性、版本一致性、私密值扫描、Hermes/本地 DOM/原生库检查与版本化归档。构建中发现 Gradle 会在生成的解题资源变化后仍复用旧 Metro bundle，已加“生成物比打包产物新则删除旧 bundle”的保护，避免交付包含旧提示词的 APK。提示词与 Skill 的单文件上限按用户授权由 8 KiB 放宽到 32 KiB（4 × 8 KiB），仍为有界检查，不是取消限制。

本轮 APK 构建耗时 1 分 54 秒（首次，含 prebuild）、1 分 7 秒与 1 分 10 秒（daemon 热），未记录旧配置的同环境对照，不宣称固定提速比例。

详见[本轮验收](THINKING_KNOWLEDGE_ACCEPTANCE.md)。

## 2026-09-17 安卓图文启动竞争

0.1.24修复Expo本地DOM初始props早于Android WebView注入到达时的启动失败，未升级或改变Pi/模型/工具权限。正常原生构建对生成HTML加入有界就绪等待；加载期限只用于可见前台题页。真机异常、首轮不足的修复、回归及最终交付状态见[展示故障记录](MULTI_QUESTION_DISPLAY_FIX.md)。

## 2026-09-17 SAT / ACT / AP

0.1.22添加exams受审Skill和三个按需参考，不升级Pi或扩大工具权限。70文件634项离线测试、8项真实模型考试样例、AP论证校验正反例及实际APK资源检查通过。按需读取、首轮失败和85秒延迟边界见[考试专项验收](EXAM_SKILLS_ACCEPTANCE.md)。

## 2026-09-17 简洁答案与按需操作

0.1.21保留锁定 Pi 与工具权限。本地默认跳过独立校验，只有用户点击才以已保存候选运行无工具 Verifier；完整步骤为单独的按需 Pi 任务，旧服务端自动路径保留。首轮 brief schema 限制空步骤，SYSTEM 精简后仍在受审策略的 8KiB 读取上限内。70文件631项单元/合约测试通过；同一真实核心的简洁答案、详细步骤、手动校验均完成，解析真值正确。验收、失败与手机检查边界见[本轮记录](ON_DEMAND_ANSWER_ACCEPTANCE.md)。

## 2026-09-17 分页、绘图与跨学科真实验收

0.1.20保留锁定Pi版本及原有工具权限。明确calculate受限语法，扩充绘图/学科Skill检查项，并修正单题误填questions数组的提示与唯一一次格式修复说明。69文件626项离线测试通过；五道自编数学、物理、化学、生物、经济JPEG题通过实际`solveOnDevice`核心及独立Verifier，另检查解析真值。数学首次结构失败已保留，修复后同题通过；不据此宣布M0完整安全验收或所有题型准确率达标。调用、渲染与真机检查边界见[验收记录](QUESTION_PAGER_FIGURE_ACCEPTANCE.md)。

## 2026-09-17 学科大类与主题阅读

0.1.15将general和现有专业Skill扩展为学科/题型方法，增加5个自编离线学科样例。没有升级Pi、增加工具或扩大执行权限。617项离线测试全部通过；主题与图文回归、APK及真机边界见[本轮验收](READING_THEME_SKILLS_ACCEPTANCE.md)。

## 2026-09-17 本地错误诊断与 Android 后台执行

0.1.14 保留 Pi 核心与锁定版本，修复 Pi 错误消息掩盖 HTTP/网络业务错误的问题；JSON 结构修复与语法修复共享一次预算。Android 前台服务只保护现有任务，原生计时器驱动取消信号，不新增模型循环。611 项全套离线测试及补充计时器后的 25 项针对性测试通过；真实验收状态见[后台诊断记录](BACKGROUND_SOLVE_ACCEPTANCE.md)。

## 2026-09-16 每题重新解答与个人页精简

0.1.10增加regenerate上下文与Solver/Verifier整题重做模式，复用Pi循环和原有独立校验，旧解答保留，个人页去除冗余说明。599项单元/编排测试及相关UI回归通过，已同签名安装并检查真机入口。没有新增真实供应商调用，见[重新解答验收](REGENERATE_ACCEPTANCE.md)。

## 2026-09-16 阅读卡片与启动就绪

0.1.9将阅读内容分卡，并等待当前答案就绪后退出开屏。70项桌面/移动用例经首轮和针对性重测全部取得通过结果，APK资源与3次真机冷启动通过，已安装到iQOO Neo9。未改变Pi、模型或存储协议；见[卡片与启动验收](READING_CARDS_STARTUP_ACCEPTANCE.md)。

## 2026-09-16 底栏分层动效

0.1.8将底栏缩放反馈改为轮廓/填充图标过渡和相机快门反馈，移除外置高亮块。桌面/移动12项导航回归、类型/lint、Web/APK构建、APK内DOM验证通过；已覆盖安装到iQOO Neo9，真机连续切换、相机返回、题目保留与图标过渡帧检查通过。未改变Pi、协议或依赖，见[动效记录](NAVIGATION_MOTION_ACCEPTANCE.md)。

## 2026-09-16 紧凑阅读与空页面

0.1.7增加默认折叠步骤、题目旁原图入口、空页面插画和导航点击反馈，移除冗余按钮。64项桌面/移动浏览器回归通过，失败/取消原图入口补充后14项状态用例再次通过。没有改变Pi或协议，见[界面验收](COMPACT_READING_ACCEPTANCE.md)。

## 2026-09-16 历史渲染与收藏

0.1.6历史列表复用本地图文渲染，加入左滑收藏/移除与个人中心收藏页。收藏以独立的版本化本机元数据保存，避免Agent结果写回覆盖收藏；Pi/模型循环未改。构建与验收见[历史与收藏记录](HISTORY_FAVORITES_ACCEPTANCE.md)。

## 2026-09-16 三入口导航与开屏

按用户确认调整为题目（当前/历史）、中央拍照、我的三入口；新增应用图标和开屏动画，保留页内草稿与解题状态。新增Expo官方splash-screen57.0.9，不改Pi/模型循环。0.1.5进一步简化答案顺序和底栏、改善超宽公式、重做图标与开屏。591项单元、60项桌面/移动浏览器回归、类型/lint、Web和0.1.5 APK构建/签名/隔离扫描通过，已安装到iQOO Neo9；真机最终状态见[本轮验收](APP_NAVIGATION_ACCEPTANCE.md)。

## 2026-09-16 安卓答案正文空白修复

后续真机已完成：用户连接iQOO Neo9后复现0.1.2还存在初始桥接函数过晚注入，0.1.3补齐加载前钩子。正式包三次冷启动恢复、公式/答案显示、知识点展开和原生追问输入桥接通过，已同签名覆盖安装到用户手机。未新增模型调用；详见[真机验收](ANDROID_ANSWER_FIX.md#013-真机修复与验收)。以下0.1.2待真机描述保留为当时记录。

用户确认0.1.1能完成解题，但只有原生校验标记，正文未显示。已定位锁定Android WebView初始JSON注入遇到换行/LaTeX时解析失败，改为schema校验的安全编码封包，增加加载失败文字兜底和仅重载正文的操作。591项单元、类型/lint、Web及0.1.2 APK构建通过；实际解包APK的DOM资源注入、公式/图示/图片、交互和窄屏离线测试通过，同签名/私密配置扫描通过。未付费重跑解题，Pi和模型配置不变；0.1.2仍待真机复核，详见[答案显示修复](ANDROID_ANSWER_FIX.md)。下文真机尚未通过的描述为各阶段历史状态。

## 2026-09-16 安卓立即解题失败修复

用户真机报告文本测试通过、点击解题立刻失败。定位到RN的 `abort-controller@3.0.0` 缺少 `throwIfAborted`，RunBudget在派发前抛错；改用aborted检查并兼容缺失reason，Pi版本和循环不变。先复现后修复，587项单元、24项桌面/移动浏览器回归、类型/lint及Web构建通过。原生兼容回归使用缺失接口的运行环境，不等于真机验收；用户尚需复测新包。详细记录见[安卓修复验收](ANDROID_SOLVE_FIX.md)。

同轮按用户追加要求实现四角/边线拖动及选框移动，默认收起数字微调；追加后589项单元、最终52项全量桌面/移动浏览器回归通过（含4项实际鼠标/触摸裁图用例及8项相机回归），0.1.1 APK构建与同证书签名检查通过。原Google云盘文件已更新，完整最终交付结果见上述记录。

## 2026-09-15 设备本地直连迁移

用户授权见[ADR 0013](adr/0013-local-device-agent.md)。同版本pi-agent-core/pi-ai 0.85.1执行本机模型工具循环，受审Skill内嵌，独立验证/预算/取消复用；coding-agent与服务器配置不进入移动包。Metro动态导入兼容用esbuild构建裁剪处理，上游未改动。新增expo-sqlite 57.0.3，本地数据与密钥隔离。真实结果：585单元、32隔离集成、44全量浏览器及新增2项CSP工具回归通过，类型/lint/build通过。Android本地APK实际编译并检查签名/SQLite/Hermes/答案资源，40.8MB；无需SolveFlow后端域名，在设置页配置模型。

**尚未进行安卓真机或真实供应商验证，iOS原生构建暂停。** 本轮没有付费调用，不把夹具响应称为真实模型。详见[本地应用验收](LOCAL_APP_ACCEPTANCE.md)。旧服务器与M0未完成的安全验收不因此变为通过。


2026-09-15原生打包增量：补齐本地Android SDK/NDK/CMake，ARM64 Release APK实际编译成功；一键compile-only打包、签名/包内资源/权限/凭据扫描通过，产物约37.8MB。新增2项配置回归、类型/lint和冻结安装通过。用户当前无域名及Mac/Expo环境，APK未配置API且未真机验收，iOS未生成IPA；未新增付费解题或云构建。见[原生打包记录](NATIVE_PACKAGING.md)。

2026-09-15旧前端清理：按用户要求删除Next源码/旧E2E及21个无用依赖包，11项有效回归迁到共享包。571项离线和32项RN Web专项回归通过，lint/typecheck/build及原地址live健康检查通过；本轮未重复集成/付费/原生验收。见[RN清理记录](REACT_NATIVE_ACCEPTANCE.md#旧代码清理验收同日后续)。

2026-09-15 RN通用客户端增量：按用户确认统一Android/iOS/Web，默认网页入口迁移到Expo/RN Web，新增共享客户端、隔离原生身份和只读幂等提交恢复。571项离线、32项隔离集成、38项RN Web E2E及lint/typecheck/build通过；三端代码/本地DOM资源导出与原生工程生成通过。没有Android SDK或Xcode，未编译APK/IPA、未真机验收，本轮未新增付费模型调用。Pi及课程Skill不变，M0安全待验收项不变。见[RN迁移验收](REACT_NATIVE_ACCEPTANCE.md)。下文测试数量和Next入口为历史记录。

2026-09-15轮次增量：按用户授权将 Solver 8→16，Verifier 保持2，总模型派发18；父授权、有限额度内部记账门、worker RPC与ProbeReport同步。553项离线、30项集成及lint/typecheck/build通过，原端口live服务已重启并健康。本轮未新增付费模型调用或App构建；见[轮次验收](SOLVER_ROUND_ACCEPTANCE.md)与[移动App评估](MOBILE_APP_FEASIBILITY.md)。下文8轮和历史数量保留为当时记录。

2026-09-15课程Skill增量：新增physics/chemistry/biology及按需参考，保留原有4个Skill，统一生产准入清单；工具与模型权限不变。548项离线、30项隔离集成、lint/typecheck（含build:server）通过；自编三科真实样例3/3 PASS，数字真值、实际工具执行、知识点及320px显示通过。见[课程Skill验收](COURSE_SKILLS_ACCEPTANCE.md)。

2026-09-14题干与知识内容增量：每题完整题干/原图裁片、可展开知识点与定向追问、数学/经济受控绘图已实现；544项离线、30项集成、34项E2E及lint/typecheck/build通过。真实数学主解答的题干/裁图/辅助图、经济供需及知识点追问通过；数学追问一次模型请求中断，未宣称整轮全通过。原图始终保留，额外坐标辅助图及实际裁片供独立核验，Sharp复用既有锁定版本；详见[题干与知识内容验收](LEARNING_CONTENT_ACCEPTANCE.md)。

2026-09-14按题持续对话：原解答/追问/澄清/进度/失败归入所属题目，reply沿来源链延伸；本题历史与更正隔离。533项离线、28项集成、32项E2E及lint/typecheck/build通过。自编两题真实4轮交叉追问全部PASS，刷新后仍按两题展示，见[按题对话验收](QUESTION_CONVERSATIONS_ACCEPTANCE.md)。

2026-09-14可用性增量：裁切/放大、澄清续答、答案版本保留、按题/步追问与题干更正已实现；529项离线、27项集成、30项E2E及lint/typecheck/build通过。真实四轮流程经一次上游中断后的有限重验通过（澄清→补充→更正→指定步骤追问，3次解答PASS），首次失败完整保留。见[可用性增量验收](USABILITY_ACCEPTANCE.md)。

2026-09-14用户澄清：允许中立政治/历史/安全教育课程解题，拒绝政治动员、立场宣传及危险请求。策略、学科识别和固定拒答文案同步，78项定向回归、lint/typecheck（含build:server）及真实6/6样例通过；以下为历史验收数量，见[用途安全验收](CONTENT_POLICY_ACCEPTANCE.md)。

2026-09-14用途/内容安全更新：Solver与Verifier固定共用系统策略，政治性与危险请求拒答；POLICY_VIOLATION候选不可发布为未验证答案。523项离线、24项集成、24项E2E及lint/typecheck/build通过。最终真实10样例9通过、1未完成模型响应安全失败，保留全部失败记录，未宣称完整安全验收；见[用途安全验收](CONTENT_POLICY_ACCEPTANCE.md)。

2026-09-14多题展示更新：明确指定最多4题、题内教学步骤/图示/结论与旧记录兼容已实现。516项离线、23项集成、20项桌面/移动E2E及lint/typecheck/完整build通过；用户保存的4题12步记录只读页面回放通过。自编四题真实流程67.474秒PASS、独立数学真值及题内图示核对通过。验收与边界见[多题验收](MULTI_QUESTION_ACCEPTANCE.md)，以下为各历史阶段记录。

2026-09-14最新更新：累计费用默认无限，按用户授权取消30元门槛及供应商硬额度确认；497项离线、23项集成及lint/typecheck/build:server通过。编译application入口与本地合成提供商验证无限模式不读取/打开账本且正常完成独立Verifier，服务预检与HTTP健康检查通过。本轮未发起付费重试，见[ADR 0005](adr/0005-optional-spending-limit.md)。下文额度及测试数量是各历史阶段记录。

2026-09-14更新：495项离线、23项集成及lint/typecheck/build:server通过。补齐Solver一次有预算的JSON语法修复及不含正文的跨worker诊断。同图真实复现确认JSON_INVALID；修复后因剩余预算不足覆盖完整链路未付费重验，见[诊断记录](UPLOAD_FAILURE_2026-09-14.md)。旧488项与真实综合题记录为9月10日历史验收。

最新补充：自动科目与图文答案已实现，二次函数综合题真实链路约62.7秒PASS，独立面积真值32/3、图示及移动渲染通过，见[本次验收记录](RICH_ANSWER_ACCEPTANCE.md)。用户明确续额的新窗口剩余19.836160元保守预占空间，旧历史完整保留。

状态：M0整体验收进行中，本地M1最小纵切已验收。当前482项离线测试通过（45文件），另有21项隔离DB/存储/Pi集成和14项桌面/移动E2E通过。2026-09-10新配置模型已完成真实网页上传→Solver/read→Verifier PASS→SSE→手机显示，4次模型请求、约6.8秒；见[M1真实记录](M1_LIVE_ACCEPTANCE.md)。历史3次命令行探针仍保留，累计7条预占27.499072元，实际扣费未知，剩余额度不足新一轮。M0所有安全门槛和公网验收仍未完成。下文分轮记录中的测试数量、费用与“未付费验证”为历史状态，以本段及M1记录为准。

## M1验收补充（2026-09-10）

新增总输出预占模式（默认capacity，经过供应商协议审查可显式request-limit），授权绑定该模式，Solver后续调用前保留Verifier费用；只读严格账本重放用于API准入，实际外发仍由独占父账本fsync授权。新增SPEND_LIMIT公共错误与移动端保存模式；已存在的幂等请求在额度不足时仍返回原run。新增6项离线回归；集成通过本地HTTP供应商驱动真实Pi与DB/S3，覆盖PASS、FAIL→PASS、再次FAIL、UNKNOWN、澄清、404、无效JSON。真实网页样本仅调用read，calculate实执行在离线HTTP协议路径验证。没有新增依赖或升级Pi。

## 模型/供应商环境配置（2026-09-10）

用户明确要求不硬编码模型或供应商，取代旧临时型号锁定。新增contracts/model、通用LLM配置和角色覆盖、configured-model、分角色model-spend；应用worker与探针均读取配置，价格和容量不再固定。旧DMX变量只作迁移别名，本机.env已保留值迁移，config:check通过。详见[模型配置](MODEL_SELECTION.md)与[ADR 0002](adr/0002-configurable-model-providers.md)。

新增18项离线回归，共476/476（45文件）通过。覆盖双供应商→真实Pi→编译worker的模型/URL/key/输出参数、不同角色报价及旧账本保留、未支持协议/冲突/缺失能力/禁止跨地址继承key。lint、typecheck、build、config:check通过；12项隔离DB/存储集成与4项桌面/移动E2E回归通过；Pi版本不变，未增加外部依赖。没有付费调用，不能把本地两供应商测试称为deepseek-flash-guan实测。

## 本地M1补充（2026-09-10）

用户明确授权后实现HTTP契约、Drizzle持久化/迁移、私有MinIO上传、Hono/API/worker、Next移动页面，Pi版本不变。新增20项离线回归：图片/身份10、HTTP契约2、正文限制2、worker公开进度持久化4、追问历史上限2；共458/458通过。集成12/12、开发与生产模式E2E各4/4通过，生产构建通过，详情见M1记录。

以下为改造前问题记录（已解决）：本机环境中的Solver/Verifier已设为`deepseek-flash-guan`，实现仍锁定原临时型号；`pnpm config:check`因此非零退出，仅输出两个型号字段。当时保留用户配置并拒绝执行；现已按用户要求使用环境引用名，配置检查通过。另有旧账本预占尚未核销，最少两请求的预算不足。本轮没有追加付费请求，不据演示测试宣称新型号/网页真实链路验证通过。

## 锁定版本与依据

| 包 | 版本 | 许可 | Node engines | 发布包未压缩体积 |
| --- | --- | --- | --- | --- |
| @earendil-works/pi-coding-agent | 0.85.1 | MIT | >=22.19.0 | 21,935,887 bytes |
| @earendil-works/pi-ai | 0.85.1 | MIT | >=22.19.0 | 4,281,282 bytes |
| @modelcontextprotocol/sdk | 1.30.0 | MIT | >=18 | 4,322,438 bytes |

来源为pnpm view发布元数据、lockfile与已安装dist类型/源码，而非main文档。Pi两包gitHead为`d981de1229ef899957bbe968bc8dcda02a21f477`，仓库https://github.com/earendil-works/pi；MCP gitHead为`2d889f2b329e46680ec9bdd565de4616c497825a`，仓库https://github.com/modelcontextprotocol/typescript-sdk。传递pi-agent-core/pi-tui/chord均为0.85.1。体积不含传递依赖。

本地Node24.19.0、pnpm11.25.0。TypeScript5.9.3（Apache-2.0），Vitest5.0.0、Zod4.5.4、@types/node24.13.3（MIT）。TS目标ES2024，适配Node24的Promise.withResolvers。未升级依赖。

## 当前实现与本次验证（2026-09-10）

- `pnpm probe:offline` 走编译 worker → 真实 Pi 会话 → 原生 OpenAI stream → 本地 HTTP 模拟服务，2次 Solver、1次 Verifier、1次成功 read、1次实际AST计算，三个请求均带自制 PNG；Verifier 无工具。这是离线夹具证据；真实VLM单题结果现见上方实测记录。
- 新增项目级 PhaseResult/SolveOutcome/ProbeReport 契约；所有阶段共用一个预算，PASS、FAIL→修正→PASS、再次FAIL、UNKNOWN、澄清、验证超时/无效schema和取消均有回归。视觉 PASS 必须包含 transcription 检查。
- `probe:live` 已有固定DMX端点/型号、服务端密钥传递、父侧费用预占和永久初始化标记；没有隐藏重试/型号fallback。每次独立 session 仅加载项目 SYSTEM/VERIFIER 与受审 Skill；Solver现在具有read/calculate，general/math依赖均就绪；Verifier仍无工具和Skill。新工具组合仅经离线回归，未再次付费验证。
- 回归先复现费用授权拒绝被SDK转成输出错误；适配器新增明确的拒绝状态，避免 Verifier 把授权失败降级成未验证结果。404 保留 MODEL_UNAVAILABLE。正常/错误均清理私有目录；父侧终止worker后回收整个run目录。
- 本次 lint/typecheck/test/build 与脱敏 config:check 结果以实际命令记录为准。`pnpm test` 343/343 通过；本地协议测试需要允许127.0.0.1监听，普通沙箱的EPERM不是代码失败。上述为上一轮离线交付结果；当时真实入口因 HARD_QUOTA_NOT_CONFIRMED 非零退出。用户随后确认额度，首次真实探针已成功，账本现有3条预占，详见实测记录。

## 继续开发：HTTP边界与实际计算器（2026-09-10）

- `mcp/http-request.ts` 直接使用Node HTTP/HTTPS，固定完整endpoint及管理员审核的IPv4地址。socket的lookup仅返回固定地址，不进行运行时DNS查询；HTTPS保留原域名与证书校验，不接受代理、重定向、OAuth跳转、Cookie或请求端覆盖凭据。私网地址必须显式批准，明文仅允许固定127.0.0.1；暂不支持IPv6或动态DNS刷新。特殊地址分类参考[IANA登记](https://www.iana.org/assignments/iana-ipv4-special-registry/)，连接参数依据[Node HTTP文档](https://nodejs.org/docs/latest-v24.x/api/http.html#httprequesturl-options-callback)及本机24.19.0测试。
- SDK解析前单响应256KiB、连接累计1MiB、响应头16KiB；拒绝压缩，JSON/SSE/心跳共享上限。请求正文32KiB、最多32次请求，最多4个活动socket及4项等待；等待/POST最长10秒、整连接最长120秒。结果层仍有32KiB限制。这里限制的是传入SDK的字节及Node接收路径，不等于进程总RSS或OS级内存隔离。
- `mcp/http-connection.ts` 使用锁定MCP SDK的fetch注入和公开Transport接口；从不可变owner/run/server/credentialVersion解析固定配置，每run独立连接，初始化失败/撤销回收socket。现有全部HTTP协议夹具改走这一边界。合成凭据双owner测试证明选取/撤销互不影响；没有将这些测试宣称为M1真实登录认证。
- 新增35项HTTP相关测试：固定地址实际连接（不可解析域名仍命中指定回环IP）、重定向不外发、错误脱敏、超大/分块JSON与无结束SSE、累计上限、有界排队、非合作HTTP取消/超时、失败初始化及并发凭据隔离。全量回归先复现RPC取消后的socket释放竞态，再以有界等待修复，未提高四条活动连接上限。
- `contracts/calculation.ts` 提供version1输入/输出；`tools/calculate.ts` 为固定语法AST解释器，不调用eval或动态属性。最多512字符/256 token/128节点/32层/1秒，非零数值范围1e-100至1e100，乘方指数绝对值≤100。sin/cos/tan/sqrt/abs/log/exp与pi/e；默认rad，可选deg，log为自然对数，无变量、物理单位或单位换算。浮点结果标approximate，保留15位有效数字；只将安全整数链路标为精确，乘方和超越函数保守标近似；除零、实数域错误、溢出/下溢和tan渐近点明确拒绝。
- 新增58项计算器测试和2项工具预算测试，替换Skill组合测试中的固定答案工具；编译CLI的离线供应商同时请求read与calculate，并核实实际计算结果。Zod JSON Schema使用`io: input`，保留angleUnit的可选语义；曾因默认output schema将其误列必填，真实Pi回归已复现并修复。实际用量/付费策略未改，未新增依赖。
- `pnpm test`：438/438通过（38文件）；`pnpm lint`、`pnpm typecheck`、`pnpm build`均exit0。`pnpm probe:offline` exit0：passed/verified/fixtureAnswerCorrect均true，2次Solver、1次Verifier、1次read、1次calculate，3个请求均含图片。改动文档的本地链接检查与`git diff --check`通过；未执行付费探针或尚不存在的Web/API集成命令。

## 历史探针记录（下面的阶段性“待完成”以本节和剩余门槛为准）

`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check`均exit0。

| 测试组 | 数量 | 实际路径 |
| --- | --- | --- |
| 预算 | 6 | 计数、配额、时间、取消前置检查 |
| 资源快照 | 17 | 不可变字节、owner、路径、大小 |
| 能力清单 | 9 | schema哈希、来源/名称匹配、身份、即时撤销 |
| Pi会话 | 19 | 真实SDK/faux、图片/read/命令/取消/预算、实际执行表漂移 |
| Skill准入 | 27 | 固定manifest、文件安全、依赖、native解析、清理 |
| 双Skill组合 | 1 | 准入→描述→两个正文→参考→测试工具→原生续轮 |
| MCP协议 | 16 | 真实stdio/HTTP、调用/错误/取消/close、参数前后上限 |
| Pi→MCP桥接 | 8 | 两传输经真实Pi Extension、预算/撤销/取消 |
| AST边界检查 | 4 | 正反向验证导入与类型逃逸规则 |

此前共321项，31个测试文件。新增原生授权stream适配器3项真实本地HTTP回归：每轮先授权、捕获固定凭据/模型/输出上限并忽略调用方覆盖，拒绝授权或型号替换时零HTTP请求，404保留MODEL_UNAVAILABLE且无重试。使用SDK公开stream函数，不另建模型循环；生产配置/session工厂与Phase错误映射仍待接入。此适配器自行调用授权门，不能再在beforeModelDispatch重复预占同一请求费用。

第八轮已验证父侧图片独立复制/转移→真实worker→编译后的phase-runner→Pi/faux→项目结果返回，覆盖Solver/Verifier；图片上限4MiB，拒绝空/超限/SharedArrayBuffer，不转移调用方Buffer底层池。共新增图片5项、编译worker2项、旧历史会话拒绝1项。合成字节只证明传递，不证明图片解码或VLM识图。事件仍为批量列表；费用预占、固定模型错误分类、生产凭据与父侧MCP生命周期尚未联通。

## 第三轮安全回归与边界

- 先复现后修复：getAllTools注册表不等于agent.state.tools实际执行表。同名替换execute/schema或重复名称曾通过；现在首次启动封存实际工具对象/execute/schema，在每次模型调用及beforeToolCall分派前后二次比对。测试包含provider响应后篡改执行器，证明新执行器没有被调用。此防护防适配器/扩展误配，不声称模型本身能修改宿主内存；首次封存必须在可信构造完成后、会话外露前。
- MCP参数在Zod前和transform后限制32KiB、2048节点、16层、字符串8192字符，拒绝getter/非JSON/循环，真实双传输超大参数回归通过；HTTP接收边界现已补齐，见上方本轮记录。MCP注册时拒绝file类别，不能挪用文件配额。
- 新packages/contracts提供版本化严格Solver/Verifier输入、候选、证据ID与校验问题交叉检查、固定公开事件/错误文案。图片仅接受已规范化的1..4MiB字节并复制，文本≤4000字符；schema不替代owner认证、图片解码、真实证据、状态机或最终verified授权。
- 新packages/config/.env.example/docs/LOCAL_SETUP.md提供固定模型/端点、默认离线、30元上限、报价与供应商硬额度确认门控；密钥不在可序列化对象。pnpm config:check只脱敏检查，不发请求。费用账本/真实适配器尚未交付，不能只因配置通过就调用。
- **第六轮非合作JS回收探针：** 新isolated-worker.ts以父侧期限/显式取消发协作消息，grace后调用Worker.terminate；只在真实exit后返回，绝不Promise.race假装结束。9项通用测试覆盖死循环/不响应signal/合作退出、超时、独立取消、输出及环境限制；另1项真正创建Pi会话，确认进入faux provider死循环后再取消，实际终止成功。
- **仍未完成的部署边界：** budgetedPrompt单独只能合作取消；worker不是OS沙箱，V8堆限额不含Buffer/native内存，JSON结果检查不等于克隆前上限。第八轮新增独立4MiB图片通道并联通编译Pi阶段；生产凭据、费用和父侧MCP子进程回收仍待实现，不能指望终止线程清理任意子进程树或native阻塞。
- **第四轮连接句柄进展：** 新RunMcpConnection固定owner/run/server/credentialVersion；Pi桥接在构造与每次dispatch前核验。独占声明按底层SDK Client而非外层适配器，重复包装也拒绝且不关闭原run。stdio/HTTP共8项真实协议测试覆盖绑定冻结、四类错配、重复占用、初始化返回时取消清理、两run并发等待时关闭一个不影响另一个。
- **仍待完成：生产凭据工厂。** 句柄只证明标签和独占关系，不能证明受信connect工厂选用了正确secret；工厂必须从服务端授权scope选择凭据，不能接受客户端owner/凭据字段。生产凭据解析/认证端点、失败初始化清理与强制回收仍待接入，不将本地无凭据夹具冒充生产跨租户认证证据。

## Pi实际接入

- ImageContent实际为`{type:"image",data:string,mimeType:string}`，与原main来源的source结构不同，设计已修正。
- ModelRuntime显式内存CredentialStore/ModelsStore、modelsPath:null、allowModelNetwork:false、refreshOnCreate:false；原生fauxProvider驱动真实createAgentSession，不重建Agent loop。内存SessionManager/SettingsManager避免开发配置加载。fetch guard未触发不是部署级禁网证明。
- tools为名字数组；customTools同名read覆盖内置工具。有效注册表仅一个read；Verifier为tools:[]。每次prompt设expandPromptTemplates:false，/skill与@路径保持字面文本；不开放直接steer/followUp（可能直接读Skill文件）。
- ResourceLoader只返回受审metadata和项目生成的data-only Extension，没有默认发现。loadExtensionFromFactory不在根包公开导出；不绕过exports访问私有模块。桥接使用公开Extension形状，经官方ExtensionRunner注册工具，而不是自定义工具循环。
- budgetedPrompt装饰公开session.agent.streamFunction，在每次模型调用前断言能力与预算；发现重试/compaction开启则失败关闭。实际验证最多8次Solver、最多2次Verifier、剩余120s总期限传播；退出恢复原streamFunction、移除监听器、清理timer并等待abort收敛。
- faux 0.85.1的factory取消抛错映射stopReason:error，不是aborted；业务以持久取消状态为准。session.abort等待idle；dispose同步，不替外部MCP做异步清理。

## Skill与受限read

- 管理员manifest明确name/directory/files/requiredTools；隐式需要read，缺依赖即excluded，不给模型注入正文或完整可用描述。最多16Skill/32文件，单文件64KiB、总256KiB、准入期限5s。general/math及代数参考为项目自制方法，无题库/学生数据。
- 不递归扫描源根，只打开获准文件。拒绝隐藏文件、脚本、AGENTS/CLAUDE、穿越、重复、过深、符号/硬链接、非普通文件、无效UTF8/NUL。最终fd用O_NOFOLLOW/O_NONBLOCK，前后核对inode/dev/mode/size/mtime/ctime及有界读取。
- 获准字节复制到私有只读临时目录（目录0500/文件0400）供真实loadSkills(includeDefaults:false)解析，再删除。metadata改成/solveflow/skills虚拟路径，正文/引用仅存在不可变ReadSnapshot。SHA256含名称、依赖、文件与内容。
- **部署前提**：管理员根及祖先、同UID临时目录不能由不可信进程并发修改。O_NOFOLLOW只保护最后分量，未声称抵御任意宿主rename竞态；尚未验收容器只读挂载/OS隔离。
- SDK内置read在operations前有fs.access探测，因此复用schema但完全替换execute，无模型可控宿主读取。保留分页/截断，最终序列化结果≤32KiB，超长行/转义膨胀明确拒绝。每次尝试预占文件配额，取消/撤销/owner和路径检查生效。
- 实测双Skill组合通过3次read与1次实际AST calculate继续原生循环；原固定答案测试工具已替换。

## 能力与MCP

项目桥接版本为当前@solveflow/agent 0.0.0源树（mcp-extension.ts），尚无Git提交/tag，未伪造版本。

- CapabilitySnapshot固定owner/run、工具名、来源、JSON可见schema SHA256与预算类别；拒绝未知/重复/漂移，批准输入后续修改不扩权。撤销信号即时传播；模型参数不能改变身份。session有效工具表在启动/每次模型调用前比对。
- 稳定MCP名采用严格server/tool语法生成mcp__server__tool，不从description/readOnlyHint授权。管理员审批schema须与远端精确匹配，另有相应Zod参数验证；暂不做通用schema方言转换。
- stdio固定绝对Node和夹具路径，最小环境；env:{}仍继承SDK默认键，显式覆盖DEFAULT_INHERITED_ENV_VARS。测试NODE_OPTIONS/哨兵不继承，stdio缓冲64KiB。
- HTTP测试仅127.0.0.1随机端口，现经固定地址/接收上限的适配器，禁重定向/重连。SDK HTTP getter与Transport exact optional类型冲突，用显式类型化转发兼容，不关闭strict、不强转。
- 只读client仅允许text，保留isError，RPC错误脱敏，resource_link/过大输出拒绝。真实Pi Extension调用经过能力授权→预占业务/搜索预算→MCP调用；search别名共享2次限额。
- 测试取消到达真实server，active归零，连接仍可调用；close回收子进程/HTTP监听。共享生产池、跨owner凭据隔离不是这些单连接探针已证明的能力。

## 剩余M0门槛

- [x] 指定型号单题真实图片解题、受限read、Verifier原图与结构化PASS；用户已确认当前令牌额度设置。
- [ ] 供应商实际用量/扣费核对及更完整的真实失败样本；单题通过不能替代这些验收。
- [x] HTTP并发owner/run凭据选取、连接撤销、失败初始化、非合作HTTP服务取消及本地socket回收。
- [ ] 非合作stdio子进程及进程树强杀/退出确认、部署OS隔离；SDK 1.30.0 stdio.close发送SIGKILL后没有再次等待close，不能用pid getter清空代替实际退出证明。
- [x] MCP HTTP解析前接收上限、固定endpoint/IPv4 socket地址、拒绝代理/重定向及限时回收。
- [ ] 生产MCP清单仍为空；真实部署出口规则、外部TLS服务和管理员根只读挂载尚未验收。
- [x] M1本地适配层签名匿名身份、owner授权、数据库、SSE与worker已整合并通过真实网页样本。正式生产身份和外部MCP接入仍未验收，见M1记录。
- [ ] M0评审所有安全前提和漏测项，包括SDK在execute前拒绝参数的工具尝试计数；当前工具执行器内的预算检查覆盖已进入execute的失败，不能据此宣称全部SDK预校验失败均已收费计数。离线测试全绿不等于完整通过。

## 安装记录

默认全局pnpm store曾SQLite打开失败；改用忽略的.runtime/pnpm-store与pnpm-cache。pnpm11普通配置在workspace YAML而非.npmrc。传递安装脚本@google/genai、esbuild、protobufjs显式禁用，已发布产物可运行当前SDK探针。传递依赖node-domexception@1.0.0的deprecated提示已知，不在功能开发中顺手升级。

## 2026-09-10 自动科目与图示扩展

当前488项离线、23项隔离DB/S3/Pi集成、16项浏览器验收通过。新增受审diagram Skill及reference，在真实Pi SDK+本地合成HTTP提供商中验证发现/正文读取/参考读取/结构化图示/独立Verifier diagram检查，不增加工具权限、不更换SDK。图示未检查时不能PASS。此记录不替代M0剩余安全门槛。详见[ADR 0003](adr/0003-automatic-subject-rich-answers.md)。

2026-09-18：0.1.25保持Pi 0.85.1与本地循环不变；新增可选选项结构、首内容事件时间/正文大小诊断，集中Skill读取和无关计算抑制。642项全量离线测试及后续34项针对性测试通过，选择题/按需步骤/手动校验12项浏览器场景通过；最终提示下自编SAT读图/转折题真实HTTP通过，详见[SAT选择题验收](SAT_CHOICE_ACCEPTANCE.md)。

2026-09-18后续：0.1.26按用户最新要求删除选择题正则兼容，模型直接返回options/selectedOptions/解释。645项全量离线及后续34项、10项浏览器场景、3道SAT/ACT真实HTTP与实际APK结构化选项测试通过；提示词曾超过8192字节现已精简到8001，未放宽安全边界。新读图样例仍有77秒长尾，未宣称速度问题解决，详见[SAT验收](SAT_CHOICE_ACCEPTANCE.md)。
