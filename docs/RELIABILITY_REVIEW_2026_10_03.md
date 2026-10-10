# 历史兼容与启动恢复复审 — 2026-10-03

早先一轮接续 [0.1.65 交叉审阅](CROSS_REVIEW_0_1_65.md)，检查历史数据兼容、任务中断恢复和导入导出。当时只更新源码和 Web 验证产物，没有重新生成 APK、操作手机或发起付费模型调用。下文保留该轮记录；生产审阅后的新增修复单列在文末。

## 已修复

1. **旧的未收藏记录阻断历史读取。** 上轮已修复导入器继续写入 `favorite:false` 的问题，但旧数据仍被只接受 `true` 的存储校验拒绝。`packages/client/src/local-repository.ts` 现在兼容精确的历史形状 `{schemaVersion:1,favorite:false}`；列表、启动恢复和导出使用同一读取函数。新写入继续以缺省键表示未收藏，不放宽公共契约，不修改原题。未知版本、错误类型和额外字段仍拒绝。
2. **一张缺失或损坏的原图阻断中断任务恢复。** 应用初始化先执行 `recoverInterrupted`，旧实现为更新任务状态读取完整图片。现在仅在仓库锁内读取和更新任务元数据，将中断任务标记为 `WORKER_LOST`，保留考试快照、既有终态及原图数据。分离图片缺失或损坏不再阻断其他历史访问；打开损坏题目的原图仍明确报错，可从备份恢复或删除该题。不会重放模型请求，也不会伪造图片。此修复不代表任意损坏的记录元数据均能自动恢复。

修改及回归入口：

- `packages/client/src/local-repository.ts`
- `packages/client/src/local-history.test.ts`
- `tests/mobile-e2e/history-recovery.spec.ts`

## 实际验证

先补回归测试，旧实现出现 3 项失败：历史 false 收藏、缺图恢复、坏图恢复。修复后：

- 相关历史、导入、引擎和批量单元测试：4 个文件、60 项通过。
- `pnpm exec vitest run`：94 个文件、804 项通过。
- `pnpm lint`、`pnpm typecheck`、`git diff --check` 通过。
- `pnpm --filter @solveflow/mobile build:web` 通过。
- `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:36715 pnpm exec playwright test tests/mobile-e2e/history-recovery.spec.ts tests/mobile-e2e/history-import.spec.ts tests/mobile-e2e/history-export.spec.ts`：桌面和移动视口共 6 项通过。重启用例实际写入 IndexedDB 的旧收藏和缺图中断记录，确认历史入口可用、任务持久化为失败、考试快照不变，重启后无 POST 请求。

日志在忽略目录 `.runtime/reliability-review-2026-10-03/`。专用 Web 测试服务完成后已停止。未重跑旧 API 集成和 Android/iOS 构建：本轮修改的是共享本地仓库恢复逻辑，已进行单元和 Web 实际存储回归；原生 SQLite 和手机生命周期仍待真机验证。

## 后续优先项

以下来自[真实测题记录](UAT_UK_LIVE_EVAL_2026_10_02.md)，本轮没有宣布解决，也没有修改首次成绩：

1. **失败诊断与最终作答阶段。** 主测 7 次 HTTP 400 被概括为 `MODEL_UNAVAILABLE`，需区分请求被拒绝与服务不可用，同时保持日志脱敏；15 次 `TOOL_LIMIT` 需要按工具阶段逐题定位，不能一律解释为调用次数耗尽或直接扩大预算。另有 6 次输出格式失败，需要专项回归。
2. **TARA 写作约束。** 已观察到要求英文却附带中文总结、模型自报词数不准确；需完善语言约束和可复核词数展示。已有正文未超 750 词，不能误报为超限。
3. **手机最终验收。** 从外部官方入口展示样卷，由 SolveFlow 相机实拍，验证裁切、解题、系统分享、连续切题与后台恢复。Pearson 仍只作外部题目来源，不进入应用或安装包。浏览器移动视口测试不等于手机实测。

## 生产审阅后的实施（0.1.70）

用户确认开始修复后，优先处理结果落盘、损坏记录和大备份三项。没有升级依赖、修改模型提示或调用付费模型，没有操作手机上的既有题目。较早的模型失败诊断已另记于 [模型可靠性](MODEL_RELIABILITY_2026_10_03.md)，0.1.69 切题与系统分享真机结果见 [真机记录](DEVICE_ACCEPTANCE_0_1_69.md)，均不冒充本轮存储故障验收。

- `packages/client/src/local-engine.ts`、`local-batch.ts`：结果写入失败后内存保留、全局阻止新任务、停止派发批量等待队列。保存重试不付费、不重复创建 run、不自动继续待解照片；删除失败不丢弃待保存结果。补充取消恰好发生在首次成功写入期间、取消更正写入又失败的回归。
- `packages/client/src/local-repository.ts`：区分无效存储内容与 I/O 故障；逐条报告损坏项，保留原字节。附加信息可显式重置，坏元数据/坏图可从备份单独恢复。完整文件验证通过后再一次事务替换；健康题目和既有诊断键不覆盖。
- `packages/client/src/local-history-export.ts`：按完整题目切成最多 128 MiB 的自足分卷，不要求把全库拼入内存。题图逐条读取，规划和实际写入均检查限额；损坏记录统计和导出确认可见，文件保持现有 v1 协议。
- `apps/mobile/src/components/{pending-saves,history-maintenance,history-export,history-import}.tsx` 与平台导入导出：接通保存重试、记录维护、选中损坏题恢复、分卷保存入口。坏图在打开题目时才被发现也会即时提示维护。模型设置和密钥不进入备份。
- `apps/mobile/src/local/documents.web.ts`：IndexedDB 批量写入发生同步异常时显式终止事务，撤回此前已经排队的写入，并返回安全错误。仅依赖 Promise 拒绝不会自动终止事务；该边界同时影响结果保存和单题恢复。旧 Web 构建的实际浏览器故障注入已复现：图片写入抛错后，原始损坏元数据却已被替换（`transaction-browser-before.log`）。Android 继续使用原有 SQLite 独占事务。

### 验证范围与剩余边界

故障测试使用独立内存仓库和浏览器测试库，不向用户手机注入损坏数据。

- 最终 `pnpm exec vitest run --maxWorkers=2`：97 个文件、833 项通过（`all-unit-complete.log`）。此前默认并发运行曾有两个既有 Pi 子进程用例触及 5 秒测试期限；当时还在编译，降低测试并发后先以 832 项全量通过，补充事务边界用例后再以 833 项全量通过，未改变断言或期限。首次、失败和复测日志全部保留。
- `pnpm typecheck`、移动端最终 `typecheck`、`pnpm lint`、`git diff --check`、Web 导出通过。
- Playwright 六个规格文件在桌面和移动视口共 32 项通过（`e2e-final.log`），覆盖结果写入配额故障、保存重试、收藏修复、单题恢复、打开坏图提示、原有导出导入、批量和辅助并发。补上 IndexedDB 显式回滚后，存储相关四个规格文件共 14 项复测通过（`transaction-browser-after.log`），其中单题恢复在真正的 IndexedDB 上注入图片写入同步故障，确认旧元数据不变、底层异常不外露，解除故障后成功恢复。两轮重复场景不累计为 46 项。
- 单元用例验证分卷输出的实际字节上限、完整头尾、乱序恢复及重复恢复；损坏题恢复覆盖截断备份、事务失败和健康记录保护。存储写入失败覆盖连续三路批量终态、暂停等待队列、重试失败后保留结果、删除失败后保留结果及迟到取消更正。
- 日志：忽略目录 `.runtime/production-fixes-2026-10-03/`。未运行旧服务端数据库集成和 iOS 原生构建：本轮修改的是设备本地仓库与界面，没有修改旧服务 API/数据库，iOS 原生构建仍暂停。

### 安装包

`GRADLE_OPTS=-Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk` 通过，5 分 48 秒。0.1.70 / versionCode 71，ARM64 内部测试包 `.runtime/artifacts/solveflow-arm64-local-0.1.70.apk`，17,253,714 字节；SHA-256 `12b6357d452f48600fe479f4e379d8832d966b26c56b8e3890389f2f7e74966d`。

同证书、签名验证、5 项私密值扫描、Hermes、3 份本地 DOM 资源和外部测试播放器排除检查通过。没有安装到手机，不把生成 APK 当作手机存储故障验收。正式发布签名仍未配置。

`node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.70.apk` 通过：直接解包验证离线桥接启动、文档绘制就绪、图像/公式/图表、历史操作、窄屏布局及注入防护。此为 Chromium 中的实际包内资源测试，不是真机。专用 Web 测试服务（127.0.0.1:43029）已停止。

### 尚未完成

- 重试保存依赖当前进程内存；系统杀进程会丢失未落盘结果，界面明确提示保持打开。已有磁盘上的中断任务仍按 `WORKER_LOST` 恢复，不重放付费请求。
- 分卷使用小容量阈值做实际导出/乱序导入/重复导入测试；不把它说成真实 500 张上限或超 768 MiB 手机压力测试。Android 文件写入分块与失败清理用已有适配器测试覆盖，原生磁盘满及系统文件选择器仍待专门真机验收。
- 普通合并导入不覆盖已有同题；单题修复只能恢复备份包含的版本。有效 JSON/图片外观错误或答案错误不属于自动修复的识别能力。
- 正式发布签名、依赖漏洞处理、生产构建与持续集成门禁，以及模型准确率完整复测仍未在本轮完成。0.1.70 仍是内部测试包，不据本轮通过宣称可正式发布。
