# 输入与后台刷新性能检查（0.1.68）
> 手机连接后的补充：真机发现 0.1.68 仍有瞬时白帧，不能由下列浏览器结果推断无闪烁。安装、对照和后续修复以 [0.1.69 真机记录](DEVICE_ACCEPTANCE_0_1_69.md) 为准。

本轮继续检查动画和性能。切题已使用原生驱动位移动画、就绪后切入与有界邻页预载；本次集中减少与输入、后台状态更新无关的 JS 和 WebView 工作，不调整动画时长、不扩大题页缓存。

## 已修复

1. `apps/mobile/src/components/answer-panel.tsx`：步骤和知识点的包装对象由父组件每次渲染重新创建，原先会使答案载荷缓存失效。现在按 runId、结果引用、验证状态等实际字段缓存，保持 schema 校验和安全编码。追问文字本身不改变这些字段，因此不再重复校验、JSON 序列化并编码整张题图。
2. 同文件与 `components/use-document-action.ts`：为答案 DOM 使用 memo 边界和稳定的动作回调，回调仍读取最新状态。实际安装的 Expo 57.0.22 `webview-wrapper.tsx` 在每次包装组件渲染时重建 `smartActions` 并发送 props；因此只缓存字符串不足以阻止无关的原生桥接。现在输入草稿时可以保留整个图文组件。可选动作仍保持可选，主题、结果、尺寸、禁用状态和错误恢复正常更新。
3. `components/batch-workspace.tsx` 与 `components/batch-pages.ts`：批次刷新仅在题目 ID、顺序或拍摄序号变化时更新题页数组。完成状态、题干摘要、批次命名变化不再使整批题号分组及邻页预载失效；名称和后台忙碌状态继续分别更新。继续待解题仍读取实时记录。
4. `apps/mobile/src/app.tsx`：单题会话分组按 runs 缓存，避免切换应用区域、展开弹窗等无关操作重新投影答案对象。
5. `components/question-pager.tsx`：回归发现 RN Web 在动画中途遇到系统时间回拨，会把题页移出可视区域并长时间停滞。位移插值增加范围限制，动画增加 400ms 结束保障；仍然先等题页就绪再开始动画，原生驱动与正常 240ms 过渡保留。取消/卸载时同时清理动画与定时器。

## 检查方法与边界

- 新增 `answer-input-performance.spec.ts`：先在旧 Web 产物上运行，输入 21 个字符触发 22 次答案载荷序列化，零重复断言失败。修复后检查缓存步骤与知识点均存在的输入场景，并验证点击“追问这个知识点”仍使用最新草稿，不因稳定回调读到旧值。
- 新增 `batch-pages.test.ts`：100 题状态/名称更新保留题页数组，删除、添加、重排、序号变化与清空正确更新。
- `batch-pager-performance.spec.ts` 增加确定性的动画中途回拨时钟场景：旧产物位移达到 33,554,400px，1.5 秒内未能回位，断言失败；要求修复后及时归位且继续切题可用。
- 使用已有并发按需请求、步骤/知识点、校验、重新解答、更正、批量操作和过渡动画测试检验回调与状态不会过期；百题压力回归检验冷页、草稿、快速连点和旋转。

本节记录手机连接前的本地浏览器与离线夹具检查。当时没有调用付费模型、连接手机或测量 Android 真机帧率；重复序列化次数下降不能直接换算为帧率或解题速度提升。后续原生切题、键盘和图片交互实测见 [0.1.69 真机记录](DEVICE_ACCEPTANCE_0_1_69.md)，未覆盖项目仍按该记录列明。

## 实际验证

- `pnpm --filter @solveflow/mobile typecheck && pnpm exec tsc --noEmit && pnpm lint && git diff --check`：通过。
- `pnpm --filter @solveflow/mobile build:web`：通过，最终日志 `web-final.log`。
- `pnpm exec vitest run apps/mobile/src/components/batch-pages.test.ts`：1 项通过。
- Playwright 功能组包含 `answer-input-performance`、`on-demand-steps`、`knowledge-on-demand`、`auxiliary-concurrency`、`manual-verification`、`regenerate`、`correction-and-cancel`、`batch-solving`、`motion-experience`，均为 `tests/mobile-e2e/` 下的 `.spec.ts`。第一次 40 项通过、4 项失败：2 项为真实的切题时钟回拨问题；1 项为初始夹具截图失败；1 项为相机模拟 Blob 尚未完成时提前发送释放事件。相机测试现在明确等待 Blob 夹具就绪，未降低布局断言。
- 最终构建重跑 `answer-input-performance`、`regenerate`、`batch-solving`、`motion-experience`，桌面与手机尺寸 **20 项全部通过**，覆盖前述失败项与最新回调检查。与之前已通过的其余场景合计验证 44 项独立功能场景。日志 `regression.log`、`final-regression.log`；输入序列化最终两个视口均为 **0 次**。
- `pnpm exec playwright test tests/mobile-e2e/batch-pager-performance.spec.ts`：**18 项通过**，包含百题连点、时钟回拨、冷题延迟、排版超时恢复、草稿保留和缓存上限。日志 `pager.log`。

所有日志均位于 `.runtime/performance-2026-10-03/`；Web 测试命令使用 `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:37531` 指向本轮独立临时服务，测试后已关闭该服务。

百题快速连点在构建和其他浏览器任务结束后独立采样，Chromium 4 倍 CPU 限速：

| 观测项 | 桌面视口 | 手机视口 |
| --- | --- | --- |
| P95 帧间隔 | 33.3ms | 33.4ms |
| 最大帧间隔 | 50ms | 50ms |
| 最多挂载题页 | 3 | 3 |
| 已加载题页横向覆盖空隙 | 0 帧 | 0 帧 |

这是单轮环境观测，不是与旧 APK 的同条件 FPS 对比；覆盖检查根据布局边界计算，不代表像素级白帧检测或真机帧率。正常完成位置、旋转及减少动态效果切换均在同一压力用例中断言。

## 安装包

`GRADLE_OPTS=-Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk` 最终构建通过（57 秒，`apk-final.log`），包含回归中新发现的时钟回拨修复。

- **0.1.68 / versionCode 69**，ARM64 内部测试包：`.runtime/artifacts/solveflow-arm64-local-0.1.68.apk`。
- **17,212,718 字节**；SHA-256：`1f3768e93a30efed1df66fb4d3347733319e2ef74fdc8eb7613d2fe106dc9cce`。
- 与既有包同签名，5 项私密值扫描、Hermes、3 份本地图文资源及外部测试播放器排除检查通过，R8 mapping 已随最终哈希归档。
- `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.68.apk`：通过，覆盖包内离线资源、公式/图片、240px 布局、就绪恢复、动态高度、操作桥接与注入安全；日志 `apk-dom.log`。这是 Chromium 中的实际包资源检查，不是手机实测。
- 本轮未运行服务端全量测试，变更集中于客户端渲染、动画与浏览器测试。
