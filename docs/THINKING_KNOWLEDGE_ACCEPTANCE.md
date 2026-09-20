# 思考控制二级化、知识点按需与打包提速验收

日期：2026-09-18。版本：0.1.28 / Android versionCode 29。

## 用户请求与对应实现

1. 把手机模型换成 DeepSeek 最新型号。
2. 设置里的“思考深度”改为两级：一级关/开，开后可选择思考强度；默认不生成知识点，与详细步骤一样按需生成；允许并发提高速度。
3. 优化打包。
4. 优化提示词和 Skill 设计。

## 模型

DMX 目录核查：`deepseek-v4.1-flash` 与 `deepseek-flash-guan` 都指向 DeepSeek V4.1 Flash（2026-09-10 发布，原生多模态），价格与容量参数相同（输入 1 元/M、输出 4 元/M，上下文 1,000,000、最大输出 384,000）。用户在设备设置中把引用名从 `deepseek-flash-guan` 改为 `deepseek-v4.1-flash`，最大输出由 8192 调整为 16384；服务地址、密钥与供应商标识未变，没有自动 fallback。

## 思考控制

两级结构：一级为服务默认 / 关闭 / 开启，选开启后再选强度（低 / 中 / 高），参数协议单独选择。协议映射在 `packages/agent/src/pi/mobile.ts`：

| 协议 | 关闭 | 开启 | 强度映射（低 / 中 / 高） |
| --- | --- | --- | --- |
| thinking.type | `thinking:{type:'disabled'}` | `thinking:{type:'enabled'}` + `reasoning_effort` | low / high / max |
| enable_thinking | `enable_thinking:false` | `enable_thinking:true` + `reasoning_effort` | low / medium / high |
| reasoning_effort | `reasoning_effort:'none'` | `reasoning_effort:<档位>` | low / medium / high |

thinking.type 协议在开启时声明 `requiresReasoningContentOnAssistantMessages`，满足 DeepSeek 对携带工具的历史轮次回传思考内容的要求。旧字段 `thinkingControl` 保留读取并映射到新结构；设备上已保存的“关闭 · thinking.type”自动迁移显示为“关闭 + thinking.type”。连接测试、每轮工具调用与手动校验共用同一设置。

## 知识点按需与并发

- brief 不再输出知识点：`knowledgePoints` 必须为空数组，`knowledgeDetails` 省略。
- 新增 `focus.kind=knowledge-list` 请求（界面“知识点”折叠面板），生成后独立缓存，重复请求由 `KNOWLEDGE_ALREADY_SAVED` 拦截。
- 知识点追问的 `sourceRunId` 指向 knowledge-list run（历史记录仍指向原答案 run），避免在无知识点的首轮候选上校验名称。
- 详细步骤、校验、知识点三类按需请求可在同一题并发（上限 3），准备阶段与结果写入串行（`LocalEngine.lock`），主对话 run 仍独占；其他题目有任务进行中时，按需按钮保持禁用。

## 打包

- 复用 Gradle daemon（`SOLVEFLOW_GRADLE_NO_DAEMON=1` 可关闭）、`--max-workers` 取 CPU 数（2–8）、`org.gradle.jvmargs` 提升到 4 GiB。
- `app.config.ts`、`plugins/`、`assets/` 都早于 `android/app/build.gradle` 时跳过 prebuild。
- 新增 `scripts/check-apk.mjs`：签名连续性、版本一致性（aapt badging）、`.env` 私密值扫描、Hermes bundle / 本地 DOM 文档 / 原生库检查，生成 `android-local-build-report.json` 并归档版本化副本。
- 修复构建缓存：Gradle 会在生成的解题资源变化后复用旧 Metro bundle（本轮实测一次构建没有重新打包刚改过的提示词），现在“生成物比打包产物新”时删除旧 bundle 强制重新打包，APK 体积与内容随之更新。

## 提示词上限

按用户授权，SYSTEM / VERIFIER / CONTENT_POLICY 与 Skill 单文件上限由 8 KiB 放宽到 32 KiB（4 × 8 KiB），仍是构建与加载时的有界检查，不是取消限制。当前 SYSTEM.md 8150 字节、最大 Skill 约 5.4 KB，均在上限内。

## 实际测试

- `pnpm test`：72 文件 658 项通过（新增 6 项思考参数用例与 1 项并发用例）；`pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。
- 真实供应商探针（`.runtime/thinking-live-probe.mjs`，三条“请只回复 OK”）：关闭 2179ms、开启·中 2228ms、开启·低 1113ms，三种参数组合均被接受；报告在 `.runtime/thinking-live-probe.json`。这是连接探针，不代表解题速度或准确率。
- 浏览器回归：desktop 与 mobile 两个 project 共 104 项通过（含新增 `knowledge-on-demand.spec.ts`）。过程中修复两处真实回归：知识点追问的 `sourceRunId` 需指向 knowledge-list run；按需面板与步骤面板共用 class 导致选择器冲突。
- 真机（iQOO Neo9，0.1.28/29 覆盖安装）：设置页显示“服务默认/关闭/开启”与协议选择，已保存的“关闭 · thinking.type”正确迁移；点“开启”后出现强度行（默认“中”）。重新解答一道 SAT 读图题后，首轮答案只显示“知识点展开”折叠面板（无首轮知识点）；点击后出现“正在整理知识点…”，同一时间触发详细步骤，两者并发完成，最终显示 3 个知识点与可收起的步骤面板。本页不包含原图、密钥或完整题干。

## 边界与未验证项

- 未做 iOS 构建；未做真实网络下的并发压力测试。
- 思考开启后的解题速度与准确率未做对照评测，只有上述连接探针。
- 最终 APK：43,804,333 字节，SHA256 `4d4dd0cc676ff6184d18ce445dafb997636a41eda6956ed15d9370d61eb1f64c`，与上一版同签名，私密值扫描与资源检查通过。本轮构建耗时 1 分 54 秒（首次，含 prebuild）、1 分 7 秒与 1 分 10 秒（daemon 热），未记录旧配置的同环境对照，不宣称固定提速比例。
