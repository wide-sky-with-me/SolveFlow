# 测试与证据

测试选择以改动影响和失败路径为依据；测试通过只证明已执行范围。命令以 [根 scripts](../package.json) 为准，假模型、实际模型、浏览器、原生包资源和真机分别记录。

## 验证选择

| 改动 | 必做的相关验证 |
| --- | --- |
| 文档、开发规则、决策 | `pnpm docs:check`；不启动应用 |
| 文档检查器、长度或归档规则 | `pnpm docs:test` + `pnpm docs:check`，含拒绝错误输入 |
| 契约、设备仓库、队列 | 对应 Vitest、类型与 lint；存储 UI 另验证隔离浏览器库 |
| 模型适配、prompt、学生 Skill | 离线 Pi/协议/预算/内容回归；获准后单列真实样例与原始成绩 |
| UI、相机、导航、分享 | 对应 Playwright；原生权限/分享/后台/绘制语义需要真机 |
| API、数据库、SSE | `pnpm test:integration`，使用随机隔离数据库与桶 |
| 构建与 Android 插件 | 构建、APK 资源/签名检查；设备验证另按操作指南 |
| 间接依赖安全更新 | 升级前失败回归、实际消费方兼容、类型与离线测试、完整导出、`pnpm deps:audit`；原生运行代码变更另做 APK/设备验收 |

## 入口与分层

根 [package.json](../package.json) 拥有命令，[测试分组](../tests/test-suites.ts)拥有离线和性能文件选择；不要在文档、CI 或额外脚本手抄另一套文件清单。新增端口、子进程或 SDK 会话测试时核对归属，分组变化须比较收集列表，证明没有漏收或重复。

| 层级 | 入口与前提 | 证据边界 |
| --- | --- | --- |
| 静态与管理 | `pnpm lint`、`pnpm typecheck`；管理检查器另用 `pnpm docs:test` | 源码边界、类型和文档，不能说明实际交互 |
| 单元 | `pnpm test:unit` | 契约、策略、客户端及注入平台适配；允许临时文件，无模型端口或独立进程 |
| 离线集成 | `pnpm test:offline` | 实际 Pi 会话、假供应商、MCP 回环、worker/子进程；需要相应本机权限，不收费 |
| 服务集成 | `pnpm test:integration`；隔离 PostgreSQL 与对象存储 | 真实事务、身份、上传与 SSE，不由离线通过代替 |
| 浏览器功能 | `pnpm test:e2e:functional`；自建 Web 服务 | 桌面/窄屏的合成图片、假模型及 IndexedDB |
| 浏览器性能 | `pnpm test:e2e:performance`；同一服务，单独运行 | 输入图片序列化、批量窗口、帧与负载；包含对应正确性回归 |
| Android | 按[打包](cookbook/android-release.md)、[隔离存储](cookbook/android-storage-acceptance.md)指南及根原生测试命令 | 包内资源、安装、系统选择器及真机逐项区分 |
| iOS 模拟器 | Mac 上按[模拟器指南](cookbook/ios-simulator.md)执行 `pnpm test:ios:smoke --app=<实际模拟器产物>` | 隔离 XCTest、合成图片、SQLite/Keychain 与本地 DOM；不代表真机、后台或真实模型 |
| 真实模型 | 先 `pnpm build:workspace` 准备脚本静态导入的 dist，再用 `pnpm test:verifier:regression --cases=.runtime/<已校验清单>` dry-run；清单结构见[脚本](../scripts/test-verifier-regression.mjs)，`--live` 必须明确授权；其他已授权评测沿既有脚本 | 固定题集、真值、容差、失败与费用，不以 mock/PASS 数量替代准确率 |

`pnpm test` 先执行 `build:workspace` 准备所有非移动 dist，再完整执行 unit 与 offline 两组，固定最多两个 worker；`pnpm test:unit` / `pnpm test:offline` 沿同一入口构建并筛选。已经完成 `build:workspace` 时，用 `pnpm exec vitest run --project unit --maxWorkers=2`（离线集成改为 `--project offline`） 定向复测，避免重复构建。CLI 仍可追加文件名/测试名。CI 在 typecheck 构建后分别执行两组，不以其中一组替代全量。

同一组通过后，仅在新增改动、失败或未解决问题要求时重跑或扩大范围；文档/配置整理不要反复启动产品。构建和时序/性能回归顺序执行，避免资源竞争；不调整断言或超时掩盖失败。日志保留首次失败与复测，重复执行不算新的样本。

## 浏览器

先构建 Web 并启动自己负责的静态服务，记录准确 URL，再设置 `SOLVEFLOW_TEST_WEB_URL` 运行 `pnpm exec playwright test tests/mobile-e2e/<目标文件>`。默认配置在 [playwright.config.ts](../playwright.config.ts)；可用 `SOLVEFLOW_TEST_CHROME` 指定已安装浏览器。禁止借用未知服务或把 fixture 端点当作真实模型。

`pnpm test:e2e` 保留完整功能与性能集合。两个分层入口复用相同设备、单 worker、45 秒超时及断言；性能组按文件划分，改动分页器仍须运行对应性能文件中的正确性回归。收集检查可以加 `--list`，但不算浏览器执行通过。

覆盖相机拒绝/上传/裁切、窄屏公式、错误重试、追问键盘、未验证标记、取消迟到和存储失败。浏览器合成图、隔离 IndexedDB 及服务 mock 不代表手机相机、SQLite 或上游模型已通过。

Android SQLite 容量故障、强杀和备份恢复使用 [独立测试包](cookbook/android-storage-acceptance.md)，与正式应用数据隔离；系统文件选择器另行显式运行。

## 付费、性能和发布

真实模型测试必须显式 opt-in，沿用已授权端点和费用设置，CI 默认 fake。保留失败和费用记录，不清零历史账本；数学等价、容差、单位与真值来源明确，不能仅由另一 LLM 判定正确率。

性能报告包含设备、内容、负载、版本、操作、样本数与原始指标；慢帧、白帧、视觉观测及内存分别解释。单轮观测和停稳快照不能宣称保证流畅或无泄漏。

发布还需跨 owner/注入/表达式攻击、取消/幂等/崩溃、图片授权/EXIF/删除、Skill/MCP 路径与生命周期验证；隔离数学服务未经无网、资源限额及强杀验收不注册。`test:math` / `eval` 未在 scripts 定义，不能用不存在的命令充当证据。

保留的初始发布目标：清晰数学正确率与澄清正确率各至少 90%，固定安全集越权/泄密为零，verified 与引用可追溯；同区域无排队首状态 p95 ≤2 秒、普通清晰题最终结果 p95 ≤45 秒。它们是待实测目标，不能因本轮通过而宣称达到。当前缺口与对应证据见 [发布状态](project-status.md)。
