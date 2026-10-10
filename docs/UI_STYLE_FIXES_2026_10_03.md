# 2026-10-03 界面样式修复

> 后续已纳入 0.1.66 / versionCode 67 APK，并追加过渡动画与大批次切题优化；安装包和最新验收见 [0.1.66 记录](MOTION_APK_0_1_66.md)。下文“未打包”指本轮最初的样式修复阶段。

依据两名子 Agent 的界面调查及用户“修复吧”授权，修复短横屏布局、深色主题可读性和小点击区域。仅调整客户端布局与样式，保留现有相机、裁切、解题及存储协议。

## 修改范围

| 问题 | 修复 | 实现文件 |
| --- | --- | --- |
| 相机拒绝权限后，短横屏说明、重试和模式选择重叠 | 中间提示与预览区独立滚动，关闭、模式与相册等操作留在滚动区外 | `apps/mobile/src/components/camera.tsx` |
| 裁切精调在 320px 宽度下标签挤成多行，横屏预览过小 | 标签单独成行；短横屏预览和控制区左右排列，精调列表可滚动 | `apps/mobile/src/components/photo-editor.tsx` |
| 深色模式快捷追问背景过亮，启用态文字对比度约 1.88:1 | 使用已有主题支持的背景及边框色，点击高度至少 44px | `apps/mobile/src/components/question-thread.tsx` |
| 解题诊断入口点击高度仅 17px | 两种校验状态的入口均增至至少 44px | `apps/mobile/src/components/question-thread.tsx` |
| 历史收藏、移除按钮白字对比度不足 | 加深默认、悬停和按下背景色 | `apps/mobile/src/dom/history.css` |
| 深色模式底栏蓝色图标内部白线被映射成深色 | 白色装饰图形保持固定颜色，其他图形继续使用现有主题与动画 | `apps/mobile/src/components/app-navigation.tsx` |

## 验证

新增 `tests/mobile-e2e/style-regressions.spec.ts` 和 `style-controls.spec.ts`。修复前，三项布局/快捷追问检查分别复现重叠、55px 标签高度、1.88:1 对比度；额外控件检查复现诊断入口 17px 高度及历史操作文字对比度不足。

- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm lint`：通过。
- `pnpm exec vitest run packages/client/src/image-crop.test.ts`：4 项通过。
- `pnpm build`：通过，包含 Web 导出、Android/iOS Hermes 和本地答案/字体资源检查；未生成原生安装包。
- 第一轮 Playwright：`style-regressions.spec.ts`、`camera.spec.ts`、`photo-crop.spec.ts`、`theme.spec.ts`，桌面/移动浏览器共 20 项通过。包含鼠标/触摸裁切与导出像素、相机流释放、迟到授权、相册降级及主题切换。
- 最终构建后的 Playwright：`style-controls.spec.ts`、`style-regressions.spec.ts`、`navigation.spec.ts`、`history-management.spec.ts`，桌面/移动浏览器共 26 项通过（1.4 分钟）。覆盖新增控件修复，并再次检查三项主要问题；两轮含 6 项重复检查，共覆盖 40 个不同测试用例。
- `git diff --check`：通过。

短屏回归覆盖 320×568、568×320、844×390，检查控件实际命中与滚动可达性；启用态快捷追问及历史操作文字要求对比度至少 4.5:1。

日志及截图位于被忽略的 `.runtime/ui-style-fix-2026-10-03/`，使用隔离浏览器数据、合成题图和固定结果，没有调用付费模型。测试使用临时本地静态服务；测试结束后关闭。

## 验收边界

浏览器移动视口与触摸模拟不能代替 Android 真机。此次没有重新打包 APK，也没有进行手机实测；已有 0.1.65 安装包不包含本次修复。后续打包后仍需检查原生横竖屏旋转、相机预览和精调滚动。

本轮未修改服务端和模型行为，未重跑数据库集成及真实模型评测。
