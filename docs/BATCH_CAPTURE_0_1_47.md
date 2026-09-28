# 0.1.47 批量拍摄、校验说明与完成跳转

日期：2026-09-23。用户要求先完成回归和打包，手机稍后测试。

## 修改

- 安卓批量拍摄使用 Expo Camera 57.0.5 的 `pictureRef`，将经过方向处理的原生像素直接交给 ImageManipulator。移除中间全尺寸 JPEG 编码、缓存写盘及再次解码；根据像素尺寸一次调度缩放和保存。保持最长边 2048、最终 JPEG 0.92、EXIF 剥离及现有锁焦。原生图片引用在保存成功、失败或离开页面后释放；只保留一张待保存照片，保存后才更新张数并允许下一张，不把未落盘照片宣称为保存成功。
- 原生文件编码使用已安装 expo-file-system 的异步 `File.base64()`；先检查 4 MiB 上限，去掉 JavaScript 字节转字符串及 `btoa`。创建批量记录时复用一次历史查询，仍在引擎写锁内检查容量与重复拍摄序号。
- `CaptureFlow` 关闭时返回非空批次身份，主页面用现有导航进入该批次，解题队列继续运行；空批次关闭不替换旧题。已有批次“继续拍摄”仍追加原批。使用说明同步修改。
- 单题、批量共用 `verificationFeedback`：超时、结果格式异常、取消/服务错误与模型给出的 FAIL/UNKNOWN 分开显示。保留具体 `issues.message`，加上识别、读图、逻辑、计算等中文类别及更正/追问入口说明。独立手动校验失败也传递安全错误代码，避免仅显示“重试校验”却没有原因。
- 识别疑点集中显示，并引导查看原图、更正题干或补充。DOM 渲染与文字降级界面采用相同校验说明；理由经既有安全 Markdown 渲染，降级界面为纯文字。

## 信息边界与兼容

只解释记录中实际存在的结果与错误代码。超时不能推断为答案错误；没有理由不补造题目错误。模型反馈标作待核对的疑点，不能保证它的学科判断一定正确，也不宣称模型核验保证正确率。原图、模型答案与原始校验记录保留，不重写历史，不触发自动付费重算。模型、提示词、预算及并发上限未改变。

AnswerDocument payload 新增可选 `verificationErrorCode`，schemaVersion 1 兼容旧调用；未改变数据库或导出格式。原生图片引用仅为拍摄流程瞬时对象，不进入 SQLite、DOM 或导出。包内继续源码编译已打补丁的相机，未新增或升级依赖。

## 验证

- `pnpm build:server`、`pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm --filter @solveflow/mobile build:web`：通过。
- `pnpm exec vitest run packages/client/src apps/mobile/src/platform-image.test.ts apps/mobile/src/navigation-state.test.ts apps/mobile/src/runtime.test.ts`：16 文件、86 项通过，包括原生图片释放、失败清理、旋转尺寸、编码上限、校验原因和队列保存不变量。
- Playwright 批量流程与校验说明：桌面/手机视口共 18 项通过；覆盖连续快门预览尺寸、相册三并发后台任务、完成后当前批次、旧批次替换及空拍摄关闭、搜索/重命名/删除、FAIL/UNKNOWN/超时/格式异常/手动校验超时、刷新及 HTML 注入防护。首次运行发现新旧隐藏页面造成的重复定位及错误夹具文案不符合安全目录，修正定位范围/夹具后通过，未削弱产品断言。

- 既有拍照、裁切、拒绝授权/迟到授权、取消、题干更正及重新解答 Playwright：桌面/手机共 16 项通过；两组浏览器回归合计 34 项。
- `SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk`：成功；生成的原生工程临时使用 Kotlin 进程内编译，结束后已恢复。签名与 0.1.46 相同，私密配置、Hermes 与 3 份本地 DOM 资源检查通过。

- `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.47.apk`：通过。直接检查实际 APK 的离线 DOM、桥接、公式/图示、240px 布局、注入防护，以及新增的超时/格式异常校验说明。Chromium 检查不代表 Android 真机。

安装包：`.runtime/artifacts/solveflow-arm64-local-0.1.47.apk`，versionCode 48，17,097,754 字节（17.10 MB）；SHA-256 `fb5e4a3858b6e2cdcbe3a3183efd032f4266dbd7228920bbf70a55ae07b13e8e`。构建日志保存在 `.runtime/batch-review-047/`。

## 首轮打包时的未验证项

按用户最新指示，本轮不安装手机、不新增手机作答记录；真实拍摄耗时、连续拍摄清晰度、方向、发热与锁焦回归须在手机上验证。浏览器虚拟快门和原生 API 单元桩不能替代实机，也不能据此给出提速百分比。没有新增真实模型费用；本次更改不代表已提升模型解题或校验准确率。

## 后续真机验收

用户随后授权安装并连接手机。0.1.47 实测清晰题保存仍需3.6～3.8秒，因此继续修订并覆盖安装0.1.48；本机三次观测降至1.6～1.7秒。完成后进入当前批次、后台保存与具体超时说明均已在真机核对。题面不同，不作为严格A/B提速比例。详见 [0.1.48 拍摄实测](DEVICE_CAPTURE_0_1_48.md)。
