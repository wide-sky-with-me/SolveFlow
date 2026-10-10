# 0.1.66 交互动画检查与 Android 打包

本轮依据用户要求检查过渡动画、连续操作和大批次切题，并将此前界面修复纳入新 APK。版本为 `0.1.66` / `versionCode 67`；不改变模型、数据协议或题目内容，不接入 Pearson 播放器。

## 已修复

- 相机、裁切、设置、题图查看、题号面板等弹层此前固定使用滑入/淡入，即使系统已开启“减少动态效果”仍播放动画。新增 `motion-provider.tsx` 与 `motion-modal.tsx`，在应用层提前读取并共享偏好，使弹层第一次展示就遵从设置，保留普通模式下的动画。运行时偏好变更优先于迟到的初始读取结果。
- `history-toolbar.tsx` 收起搜索时原先立即移除输入框，再将空白区域高度缩回，造成内容突然消失。现在内容保留到收起动画结束；退出时立即失焦并禁止编辑和点击，快速重新展开可继续动画并恢复焦点。
- `question-pager.tsx` 在大批次切题、加载与就绪更新时原先重新构建全部题号。现在缓存题号分组，并按四个题号一组保留渲染结果，仅更新选择变化的组；宽度、题目和主题变化仍正常更新。未改变切题等待、滑动或缓存窗口逻辑。
- 截图复查发现总数达到 100 题时，固定 32px 的进度计数会将 `11/100`、`100/100` 换成两行。三位数总数现在使用 52px 固定宽度并保持单行，切题时宽度不跳变；新增 320px 竖屏及 844px 横屏回归，要求不换行、不截断且末题导航可见。
- 包含上一轮相机短横屏、裁切精调、深色快捷追问、诊断点击区域、历史操作文字及底栏图标修复，详见 [界面修复记录](UI_STYLE_FIXES_2026_10_03.md)。

## 检查方法

新增 `tests/mobile-e2e/motion-experience.spec.ts`：验证减少动态效果、普通动画、运行时偏好切换、连续开关弹层、搜索收起中途重开及键盘焦点。两项初始回归均先在旧构建复现失败，再验证修复。

扩展 `batch-pager-performance.spec.ts`：使用产品允许的最多 100 张批量记录，Chromium 4 倍 CPU 限速下每 70ms 连点，12 次下一题后 4 次上一题；逐帧采样题页覆盖、挂载数量和帧间隔，检查最终题号、旋转与减少动态效果切换。帧间隔仅用于环境内观察，不等同 Android 真机 FPS。首次测试误用了 120 条记录，超出契约上限导致历史读取拒绝；已修正测试数据，并增加上限检查，未放宽产品限制。

沿用冷题读取延迟、排版延迟与超时恢复、草稿回收后恢复、题图触摸缩放/分享、裁切导出像素、相机释放、历史手势及解题等待动画回归。全部使用隔离浏览器数据与固定模型响应，未调用付费模型。

### 大批次帧采样

在构建及其他检查结束后，使用相同 Chromium、100 题和 4 倍 CPU 限速分别采样。题号栏优化前后如下（单轮观察，非真机验收或统计基准）：

| 指标 | 桌面视口优化前 → 后 | 移动视口优化前 → 后 |
| --- | --- | --- |
| P95 帧间隔 | 66.7 → 33.3ms | 50.0 → 16.8ms |
| 最大帧间隔 | 83.3 → 50.0ms | 66.7 → 33.4ms |
| 连点开始至目标稳定 | 1455.5 → 1786.5ms | 1729.3 → 1727.3ms |
| 最多挂载题页 | 3 → 3 | 3 → 3 |
| 内容已加载题页的横向覆盖空隙 | 0 → 0 帧 | 0 → 0 帧 |

前后都正确停在第 9 题，接着切题旋转、切换减少动态效果、题页数量回落检查均通过。覆盖采样按页面边界和题干节点计算，不能等同像素级白帧检测；帧间隔会受宿主调度影响，最终完成时间也不保证同步缩短。日志为 `performance-baseline-isolated.log` / `performance-axis.log`。

采样脚本首次错误要求可见页存在 `aria-hidden="false"`，而 RN Web 会省略该属性，因此误报未稳定；页面实际已到第 9 题。已按实际 DOM 改为排除 `aria-hidden="true"`，保留最终位置、覆盖与帧数断言后复测。

## 环境与边界

本机 Android SDK/Java 构建检查通过。受限执行环境无法启动 Java，使用获准的构建环境执行；没有新增或升级依赖。ADB 连接查询 10 秒超时，未安装或操控手机。

测试日志、截图与构建日志位于 `.runtime/motion-0.1.66/`。浏览器触摸模拟、帧采样与包内 DOM 检查均不能替代原生相机、键盘、系统分享和 Android 渲染帧率实测。

## APK 产物与已执行检查

- 版本化产物：`.runtime/artifacts/solveflow-arm64-local-0.1.66.apk`。
- 版本：0.1.66 / 67，ARM64 内部测试签名；17,212,226 字节（17.21 MB）。
- SHA-256：`f4e9c4863e52c75af29f2cfa964306bdf0a53c9bfbbbca4159113138ffa0ee8a`。
- 构建命令：`GRADLE_OPTS=-Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk`，最终构建通过（42 秒），日志 `apk-delivery.log`。
- 自动包检查通过：签名有效且与旧包一致、版本匹配、5 项本地私密值扫描、Hermes/三份 DOM 资源齐全、外部测试播放器扫描通过；对应 R8 映射同步归档。
- `pnpm --filter @solveflow/mobile build:web`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm lint`、`git diff --check`：通过。
- `pnpm exec vitest run tests/unit/native-build-config.test.ts tests/unit/dom-bootstrap.test.ts apps/mobile/src/navigation-state.test.ts`：12 项通过。
- Playwright 第一组冷切题、草稿保留、导航与动画：28 项通过；另 2 项因上述 120 条测试数据越界失败，修正后单独运行上限压力测试。
- Playwright 最终体验组：`motion-experience`、`camera`、`photo-crop`、`image-viewer`、`solve-progress`、`batch-solving`、`style-regressions`、`style-controls`、`history-management` 共 48 项通过（3.1 分钟）。
- 题号分组优化后的分页回归：`batch-pager-performance`（当时不含新增百题计数用例，排除已单独采样的压力项）、`question-pager`、`pager-layout` 共 28 项通过（2.0 分钟）。另 2 项百题帧采样通过，见上表。
- 百题计数修复前复现 36px 两行高度；最终构建后窄屏/横屏计数回归 2 项通过（11.9 秒），单行且不截断，末题按钮和题号导航正常。
- `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.66.apk`：通过。覆盖真实包内桥接迟到恢复、字体与公式、图表/图片、历史动作、240px 窄屏、离线资源及注入防护；不属于原生设备测试。

上述包内检查已对最后一次构建重新执行，结果记录于 `apk-document-final.log`。临时 Web 测试服务在验收后关闭。

未执行 iOS 原生编译、手机安装及真实模型评测。本轮没有修改服务端或模型行为，未重跑数据库集成测试。
