# 图片系统分享与多题切换（0.1.61）

2026-09-30，针对用户反馈的长按不能分享、题多时切换卡顿修复。仅调整设备端交互、资源保留及读取合并；模型、Pi 循环、持久化契约和调用预算不变。

## 已复现的问题

- 大图只有缩放和拖动，没有系统分享调用。新增长按回归在旧 Web 导出上失败。
- `QuestionPager.visited` 只增不减，浏览过的页面及 WebView 一直挂载；`BatchWorkspace` 打开时 `Promise.all` 读取整批图片，模块级 `batchRecordCache` 不回收。22 张合成记录的旧版进入回归记录到 23 次完整记录读取。
- 连接手机旧版 0.1.60 / 61 的进程采样：WebViews 50、Views 1694、TOTAL PSS 1,626,021 KiB、TOTAL RSS 433,660 KiB、TOTAL SWAP PSS 1,371,686 KiB。这是既有浏览进程采样，非控制变量下的峰值或帧率基准。
- 去除缓存后补齐读取期间事件合并，防止迟到的旧磁盘快照覆盖最新完成/取消结果。

## 实现

- `share-image.native.ts` 使用与 Expo 57 配套的 `expo-sharing@57.0.19`（MIT，npm 解压 271,139 字节）。[官方接口依据](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/)及安装版本的 `Sharing.ts` / Android `SharingModule.kt` 均已核对。lockfile 仅新增该包，没有升级既有依赖。
- 分享实际 JPEG/PNG/WebP 文件，使用应用私有缓存及系统授予的临时读取 URI；不上传题图，不传数据 URL 作为文本。原生最多保留八份分享缓存，下次分享时删除超出上限或超过 24 小时的缓存。选择目标应用后文件暂留，避免接收端尚未读完就被删除。
- 题目缩略图、原题插图和全屏大图均支持长按，插图分享完整原照片；大图保留显式分享按钮。移动超过 8px、双指、取消、卸载均取消长按计时；长按后抑制打开大图的点击。Web 使用文件形式的 Web Share API，不支持时明确提示。
- 每层分页最多挂载四页（当前、前后邻题及过渡旧页），稳定时最多三页。相邻预加载在切换动画结束后执行，离开窗口就释放题图和 WebView；不再全批预读或使用全局题图缓存。`BatchQuestion` 使用 memo，状态刷新不再每个阶段都重读整份历史索引。
- 当前阅读器单独保存轻量草稿、指定追问、选中的历史解答、内层题号、滚动位置、步骤/知识点展开和图示缩放状态。离开整个阅读器后释放，不写入全局缓存或新增数据库字段。
- 预加载页使用原生辅助功能隐藏及 Web `aria-hidden` / `inert`，不参与键盘焦点或辅助功能遍历。

## 验证记录

- 旧版新增回归失败：长按没有分享调用，22 题初次读取 23 次完整记录。
- `pnpm install --frozen-lockfile` 通过。
- 全量 `pnpm test` 初次在沙箱内因 loopback socket `EPERM` 等运行环境约束失败；按正式命令在允许本地 socket 的环境重跑，91 文件 / 762 用例通过。后续增补读取竞态和缓存复制测试后，`pnpm exec vitest run` 再次通过：91 文件 / 764 用例。
- `pnpm lint`、`pnpm typecheck`、`pnpm --filter @solveflow/mobile build:web` 通过。
- `pnpm exec playwright test tests/mobile-e2e/batch-pager-performance.spec.ts tests/mobile-e2e/question-pager.spec.ts tests/mobile-e2e/batch-solving.spec.ts tests/mobile-e2e/image-viewer.spec.ts`：桌面/移动共 14 项通过。布局另有 14 项、题干/知识点另有 2 项通过。新回归限制初次完整记录读取不超过 4 次，连续浏览到第 12 题期间挂载页不超过 4 个，返回首题草稿与步骤/知识点展开状态仍在，POST 请求为零。
- `pnpm mobile:apk` 通过，0.1.61 / versionCode 62，17,144,686 字节；SHA256 `0591b86c252bd5e93021a91d331a3b9c03797e5bf004dda7bcc2c2f39af4488b`。包签名与旧版本一致，服务器私密配置扫描、Hermes 与本地 DOM 资源检查通过。
- `adb install --no-streaming -r .runtime/artifacts/solveflow-arm64-local.apk` 成功，手机包管理器确认版本 0.1.61 / 62。

不以浏览器的模拟分享回调代替 Android 系统分享验收，不以截图宣称固定帧率；本次不调用真实付费模型，也不发送题图给其他人。


## 真机采样（Android 15，vivo V2338A）

覆盖安装后保留了界面中可访问的六个批次（50、1、22、22、27、27 张）。打开原有 50 题批次，在第 1 题停留时采样为 2 个 WebView、TOTAL PSS 368,432 KiB。以约 0.38 秒加 ADB 命令时间的间隔点击“下一道题”24 次，确认到第 25/50 题，采样为 3 个 WebView、TOTAL PSS 450,319 KiB、TOTAL RSS 640,340 KiB、TOTAL SWAP PSS 309 KiB。页面资源不再随访问题目数量线性积累。

该段快速切换的 `dumpsys gfxinfo` 记录 704 帧，Janky frames 144（20.45%），帧耗时中位数 7ms、p90 32ms、p95 44ms、p99 65ms。这说明内存累积已得到控制，但快速连续冷切题仍有掉帧；不能宣称“零卡顿”或固定 120 FPS。旧进程和新版采样非同起点，不以两次 PSS 计算严格性能提升百分比。


长按第 25 题的原题插图，真机进入 `com.android.intentresolver/.ChooserActivityLauncher`，界面包含 `scrollable_image_preview` 图片预览。取消后点击插图正常打开全屏大图（100%），大图可见“分享题目图片”和“关闭大图”；再次长按大图也进入同一系统分享面板并有图片预览，随后取消。未选择分享目标、未向联系人发送图片。相关本机采样保存在 `.runtime/share-pager-*.xml` / `*.txt`，不提交真实题图或设备截图。

本次没有运行数据库/私有对象存储集成测试，未修改这些路径；未构建 iOS（项目暂停原生 iOS 构建）。全平台 `pnpm build` 未重复运行，本次执行 Web 导出及 Android APK 原生编译，覆盖实际交付平台。
