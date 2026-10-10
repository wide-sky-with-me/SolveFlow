# 0.1.50 原题图片查看

2026-09-29 用户要求：像手机相册一样点击图片，独立查看、双指缩放与拖动，不再显示“放大原题图”按钮。

## 实现

- `apps/mobile/src/dom/problem-statement.tsx`：直接点击原题插图打开整张原照片；纯文字题提供 88px 照片缩略图。移除标题旁的原图文字按钮和插图内联放大按钮。
- `apps/mobile/src/components/image-viewer.tsx`：独立黑底查看器，仅保留关闭图标。双指 1～4 倍缩放，放大后拖动，双击放大到 2 倍或还原；关闭、系统返回后保留原题位置。重开和屏幕尺寸变化时重新适配。
- 复用原有 `image-zoom.ts` 的焦点保持、平移边界和换指处理，没有新增图片或手势依赖。保留屏幕阅读器调整操作，并支持网页版键盘加减号、上下键缩放及 0 还原。
- 单题待解图、批量待解图、失败/取消结果、DOM 加载失败的文字回退均可直接点击图片查看。生成的解答图示保留原有独立操作。
- 操作说明集中到“使用说明”，查看器不显示文字工具栏。不改变作答、模型设置或已有记录。

## 验证

- 先更新回归用例，在旧构建上确认点击图片入口缺失，测试失败；实现后重测。
- `pnpm lint`、根 TypeScript `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck` 通过。
- `pnpm exec vitest run apps/mobile/src/components/image-zoom.test.ts`：4 项通过，覆盖适配、缩放焦点、边界、换指拖动。
- `pnpm --filter @solveflow/mobile build:web` 成功；Playwright 的 image-viewer、workspace、learning-content、result-states 两种尺寸共 24 项通过。真实触摸事件验证 1→2→4→1 倍及抬起一指后平移，桌面验证双击，重开和横屏适配；图片查看测试零 POST。
- 同步修正 result-states 中过时的泛化校验提示断言：按当前实现检查“校验无法确认”和模型提供的具体问题，没有降低验证失败的展示要求。

- 补充图片实际宽度随手势翻倍和网页版键盘缩放/还原断言，image-viewer 两端再测 2/2 通过。
- `pnpm mobile:apk` 成功，0.1.50 / versionCode 51，17,109,470 字节；签名与前版一致，私密配置扫描、Hermes 和 3 份 DOM 资源检查通过。临时 Kotlin 进程内编译参数已在结束时移除。
- `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.50.apk` 通过，包括实际 APK 中点击题图到原图查看回调。该项为 Chromium 检查，不冒充真机手势。
- APK SHA256：`f258cdf19f97bfaffbf23e32c909ba74624c88d3356e125a5570f3d51e48e722`。
- `adb install --no-streaming -r` 返回 Success，手机读回 0.1.50 / 51；没有卸载或清除数据。

## 真机结果

iQOO Neo9 / V2338A，保留 106 张题图、6 个批次（3/5/22/22/27/27）。本轮只读取已有记录，没有修改设置、重新作答或产生模型费用。

- 打开已有批次第 2 题，直接点击题面插图进入黑底全屏查看器，只有关闭图标；截图确认整张原照片可见。
- UiAutomator 注入真实双指事件并读取原生 accessibility range：100% → 约200% → 400% → 100% 通过。放大后单指拖动，截图像素匹配确认横向约117px位移（输入120px），比例不变。
- 双击到200%，再次双击还原100%，关闭回到同一批次第2题；重新点击插图以100%打开，安卓系统返回只关闭查看器，仍在第2题。
- 设备快照、手势断言、截图、构建与安装日志仅存忽略目录 `.runtime/device-050/`；手机临时测试 jar/XML/截图已清理。

未运行全量服务端/数据库/模型评测，因为本次仅更改图片入口和客户端手势；没有新增真实拍摄或解题测试。iOS 未做原生构建或真机验收。
