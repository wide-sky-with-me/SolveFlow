# 安卓点击解题立即失败修复（2026-09-16）

用户真机反馈：`deepseek-flash-guan`、输出上限8192，设置页连接测试通过，点击拍照解题立即显示“服务暂时无法完成请求”。

## 根因和最小修复

当前RN 0.86.3在 `Libraries/Core/setUpXHR.js` 使用 `abort-controller@3.0.0`。实际加载该依赖确认 `signal.throwIfAborted` 和 `signal.reason` 都不存在；Expo 57只补充静态 `AbortSignal.any/timeout`。共享 `RunBudget.assertActive` 原先直接调用前者，在第一次模型派发之前抛出TypeError，编排层将其安全转换为INTERNAL_ERROR。设置页短文本连接测试不经过RunBudget，因而可以成功。

`packages/agent/src/policy/run-budget.ts` 改用标准 `signal.aborted` 判断，保留已有reason，没有reason时产生AbortError。没有修改上游、扩大轮次/时间预算或增加依赖，也没有硬编码模型/供应商。

先添加缺失该接口的完整Pi回归：修复前1失败/8通过；修复后覆盖read→calculate→Solver→独立Verifier，以及开始前取消。另补原生signal无reason时取消不消耗任何模型/工具次数。生成的移动Agent包已没有 `.throwIfAborted()` 调用。

失败界面增加白名单错误代码，便于用户反馈；不展示原始异常、密钥、模型思考或网络响应。App版本升级为0.1.1、Android versionCode 2，沿用包名和签名以支持覆盖安装。

## 同轮追加：手动拖动裁切

用户要求拍照后直接拖动裁切。`apps/mobile/src/components/photo-editor.tsx` 使用共享RN PanResponder支持四角/四边缩放和框内整体移动，手势处理器保持稳定，单指操作不会把拖动交给外层滚动。框外遮罩提示最终范围，图片按可用空间等比缩放，确认按钮固定底部。原来的百分比按钮收进“精细调整”，保留键盘和辅助操作入口。

`packages/client/src/image-crop.ts` 将预览坐标转换为原图百分比，移动时保持宽高、在图片边缘停止，缩放时禁止翻转/越界。没有引入裁切依赖或改变原图压缩与EXIF处理路径。纯数学测试覆盖拖动、四边约束与最终像素位置；浏览器新增鼠标/触摸事件及实际导出图片像素验收。

## 验证

- `pnpm typecheck`、`pnpm lint`、`git diff --check`通过。
- `pnpm exec vitest run`：解题修复587项；追加拖动裁切后589项、61文件通过，无真实模型请求。
- `pnpm --filter @solveflow/mobile build:web`通过。
- Playwright `local-app.spec.ts` 和 `result-states.spec.ts`：24项桌面/移动用例通过，包含移除throwIfAborted/reason后的完整Pi工具及校验链路、取消/错误展示和320px窄屏。临时测试地址为 `http://127.0.0.1:38538`，PID 59739，测试结束已关闭，没有启动长期替代服务。
- APK最终结果见下方交付记录。

日志：`/tmp/solveflow-native-fix-{typecheck,tests,web-build,e2e,apk}.log`。本轮未重复旧服务端DB/MinIO集成测试：没有数据库/HTTP契约变更，共享编排与预算已运行全部单元回归。iOS原生构建继续暂停。

追加裁切的首次浏览器测试发现横屏展开微调后确认按钮越界，已缩小横屏微调面板；坐标测试也暴露Modal动画尚未结束就取坐标的竞争，改为等待真实角点稳定后再开始手势，保留导出尺寸和像素断言。未把失败执行标为通过。

后续坐标测试改为明确的整数鼠标/触摸位移（避免浏览器MouseEvent子像素取整），按实际位移计算期望裁图尺寸；等待图片解码后读取真实像素，并检查取消保留原图。最终4项专门手势用例全部通过。相机8项回归在修正横屏微调后全部通过。

## 交付产物

- `.runtime/artifacts/solveflow-arm64-local.apk`：0.1.1 / versionCode 2，ARM64、最低Android API 24，40,786,538字节。
- SHA256：`0b7145513808026eb4f34648998f46eafb413c2aeca6ba6d76bd013779d69a20`。
- `pnpm mobile:apk`（指定已有Java 17路径）成功，最终构建1分34秒；签名验证通过，与保留的0.1.0包证书一致。SQLite库、Hermes包、本地答案HTML齐全，无.env文件，解压后匹配3项实际私密配置均未命中。
- 原包保留为 `.runtime/artifacts/solveflow-arm64-local-0.1.0.apk`。没有修改数据结构或清空用户记录。
- 本轮首次 `mobile:doctor` 的子进程Java检测未通过；显式指定本机已安装 `JAVA_HOME` 后实际Gradle构建通过，未安装新的Java/SDK。
- 裁切日志：`/tmp/solveflow-crop-{tests,web-build,e2e-final,gestures,apk,apk-check}.log`。本机验收报告 `.runtime/artifacts/android-local-build-report.json`。
- 最终全量Playwright：**52项通过（1.5分钟）**，含桌面/移动鼠标与触摸裁切、相机、原生signal兼容解题、追问/取消/错误/图文公式。日志 `/tmp/solveflow-crop-e2e-all.log`；临时服务已关闭。最终根/移动类型检查、lint和diff检查通过。
- 按既有Google云盘交付方式更新原文件，名称为 `solveflow-0.1.1-arm64.apk`，文件ID不变；元数据回读大小与本地产物一致。[安装包](https://drive.google.com/file/d/1CUh5WOK_MBiUDdFfCcJjBgmpl279YcMZ/view?usp=drivesdk)。

没有取得用户手机日志，没有本机安卓模拟器或实体机验收。此修复消除了已复现的原生必现故障；不能据离线Pi夹具和APK编译宣布手机实际模型、相机与完整解题全部通过。待用户覆盖安装后验证。
