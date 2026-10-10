# UI 一致化检查（2026-10-03）

本轮接续 0.1.66 的样式和动画修复，检查原生组件与答案 DOM、辅助页面与居中弹窗之间的视觉差异。没有新增依赖或改变解题流程。

## 修改

- `apps/mobile/src/components/ui.tsx` 从 `theme/palette.ts` 引用基础颜色；`dom/theme.css` 对齐正文、辅助文字和分隔线颜色。浅色辅助文字从 `#6b7a90` 改为 `#607087`，在白色、页面底色与浅蓝底色上的对比度分别约 5.04、4.70、4.53；深色主题保留原有配色。
- `dom/answer.css` 将校验与窄屏重新解答按钮统一为最小 44px、13px 字号、12px 圆角，与原生紧凑按钮一致。普通主操作仍为最小 48px。
- `components/ui.tsx` 增加共享页面布局：最大宽度 720px、内边距 20px、区块间距 16px。设置、导出、恢复、使用说明、更正题干和诊断页面复用；导出与恢复增加独立滚动容器，长状态文案不会将返回入口挤出可滚动区域。
- 新增 `components/dialog-surface.tsx`：统一最大宽度 420px、外侧留白 24px、居中卡片与可滚动内容。外观、删除确认和批次名称使用同一容器；批次名称保留键盘避让，操作与取消逻辑保持。
- 辅助页面及弹窗标题补齐标题语义。阅读正文仍保留原有宽度、字号层级，不将长篇阅读套用表单宽度。

## 回归方法

新增 `tests/mobile-e2e/ui-consistency.spec.ts`。旧 Web 产物先运行移动尺寸测试，3 项均失败，复现校验按钮 36px、紧凑按钮字号不一致、原生与 DOM 颜色差异、导出标题横跨 1362px、外观弹窗横跨 1392px。

修复后的检查包含：320px 窄屏操作尺寸与颜色角色、1440px 桌面内容宽度与弹窗居中、568×320 短横屏下滚动后的控件命中，以及系统深浅主题切换。截图与日志位于 `.runtime/ui-consistency-2026-10-03/`。

本轮浏览器使用本地夹具与模拟模型响应，没有发起真实付费解题；没有连接或安装手机。浏览器触摸模拟和包内 DOM 检查不能替代 Android 键盘、系统安全区与实际触感验收。

## 已执行检查

- `pnpm --filter @solveflow/mobile build:web`：通过。
- `pnpm --filter @solveflow/mobile typecheck && pnpm exec tsc --noEmit && pnpm lint && git diff --check`：通过。首次检查发现相机颜色引用漏导入、浏览器测试跨包直接导入主题文件引发模块模式不兼容，均已修复后重跑。
- `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:37851 pnpm exec playwright test tests/mobile-e2e/ui-consistency.spec.ts --output .runtime/ui-consistency-2026-10-03/ui-results`：桌面与手机尺寸共 6 项通过，包含追加的双轴居中断言。
- 相关回归运行 `pnpm exec playwright test`，文件为 `theme`、`style-controls`、`style-regressions`、`history-export`、`history-import`、`history-management`、`batch-solving`、`exam-settings`、`correction-and-cancel`、`motion-experience`，均在 `tests/mobile-e2e/` 下，后缀 `.spec.ts`。首轮 45 项通过、1 项在空白页生成夹具截图时出现 Chromium `Page.captureScreenshot` 错误，尚未进入应用。保持所有断言，使用 `history-management.spec.ts --project=desktop --grep 'single question returns'` 单独复测，该项通过。共 46 项相关场景完成验证，日志 `regression.log`、`history-recheck.log`。

## APK

- `GRADLE_OPTS=-Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk`：构建通过（4 分 11 秒）。
- 版本 **0.1.67 / versionCode 68**，ARM64 内部测试包：`.runtime/artifacts/solveflow-arm64-local-0.1.67.apk`，**17,211,050 字节**。
- SHA-256：`e66648ed706d230df7fb5b1621366c2a6b9e4756c77c916c06db63b857dadb68`。
- 签名有效且与既有包一致，5 项私密值扫描、Hermes、3 份本地图文资源、外部测试播放器排除检查通过；R8 mapping 随版本归档。
- `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.67.apk`：通过。直接提取最终 APK 中的资源，覆盖离线字体/公式、图片/图形、240px 窄布局、初始内容与原生桥接恢复、动态高度、操作回调及注入安全；日志 `apk-dom.log`。这是 Chromium 中的包内资源测试，不是原生 WebView 或手机实测。
- 临时 Web 测试服务已关闭。未执行服务端全量测试，本轮变更集中于客户端样式与布局；实际手机安装和键盘体验仍待设备验收。
