# React Native 通用客户端迁移验收

> 最新：用户已授权设备直连模型与本地存储，见[本地应用验收](LOCAL_APP_ACCEPTANCE.md)。当前安卓命令 `pnpm mobile:apk` 生成 `solveflow-arm64-local.apk`，启动后在设置页填写模型；不再需要 EXPO_PUBLIC_API_URL 或 SolveFlow 后端域名。下文较早的 API 缺失/编译检查包记录属于迁移前状态。iOS原生构建已暂停。

**后续打包进展：Android工具链已补齐，ARM64 APK原生编译已通过；当前为未配置API的编译验证包，iOS包和真机验收未完成。见[原生打包记录](NATIVE_PACKAGING.md)。以下“尚无SDK/安装包”等为此前迁移阶段记录。**

日期：2026-09-15。用户明确授权 Android、iOS 和 Web 全部统一 React Native。架构决定见 [ADR 0012](adr/0012-react-native-universal-client.md)。

本轮完成通用客户端代码、默认 Web 切换、后端原生身份适配、离线/集成/RN Web 验收及三端代码导出。**尚未完成 Android/iOS 安装包编译或真机验收，本轮未新增付费模型调用。** 历史真实模型记录仍有效，但不能等同本次原生端已经实测。

## 旧代码清理验收（同日后续）

按用户要求删除旧Next前端及缓存、原8个E2E文件，清除Next/Tailwind依赖、workspace过滤项、专用排除规则及旧目录说明。pnpm离线重建锁文件并冻结安装通过，移除21个不再使用的依赖包；`apps`仅剩`api`和`mobile`。

旧前端的11项有效单元回归迁入共享包：`packages/client/src/math-delimiters.test.ts`、`image-crop.test.ts`和`packages/contracts/src/question-sections.test.ts`，测试当前RN共用代码；历史题目兼容逻辑继续保留。

本次实际复验：`pnpm build`、`pnpm typecheck`、`pnpm lint`通过；`pnpm test` **571/571（58文件）**；针对相机、更正/取消、题干/知识点、按题对话、结果状态和富文本的RN Web浏览器回归 **32/32**。这是选定6个当前spec的桌面/移动检查，不宣称重跑上一轮全部38项。本轮未更改API行为，未重复数据库/存储集成测试，也未执行付费模型或原生编译。

残留扫描确认旧源码目录、构建引用及Next/Tailwind锁项已移除，当前文档链接检查通过。全程保留现有服务；末次检查网页HTTP200、API模式live且solvingAvailable=true。没有清理数据库、私有图片、配置或历史费用账本。日志：`/tmp/solveflow-clean-{build,typecheck,lint,test,browser}.log`。

## 实际实现

| 范围 | 当前行为与主要文件 |
| --- | --- |
| 统一界面 | `apps/mobile/src/app.tsx`：RN 首页、题目历史、拍摄/相册、裁切/旋转、大图、保存/提交、进度、取消、删除、更正、题内追问；桌面/窄屏共用组件 |
| 按题学习 | `components/question-thread.tsx` 与 `packages/client/src/question-conversations.ts`：按题隔离追问、步骤/知识点上下文及更正，默认展示最新解答，历史可展开 |
| 图文公式 | `src/dom/`：本地 Expo DOM 答案组件，KaTeX、Markdown、原题复述/原图裁片、受控SVG、知识点。原生外层和输入使用RN；仅复杂图文区域使用随包发布的WebView |
| 相机与图像 | 原生Expo Camera/ImagePicker/ImageManipulator；Web采用受控getUserMedia/Canvas平台适配。裁切、旋转、压缩和临时文件回收；不请求录音或全相册读权限 |
| 网络与恢复 | `packages/client`：共享schema、超时/取消、SSE解析去重/快照恢复、每题独立幂等提交记录。断线不重复创建任务，回前台恢复进度 |
| 原生身份 | `apps/api/src/auth.ts`、`app.ts`：独立purpose签名的Bearer，原生SecureStore保存；浏览器继续HttpOnly Cookie及Origin校验。保持所有owner边界，不新增CORS放行 |
| 提交恢复 | 只读 `GET /api/v1/sessions/:id/submissions/:key`，沿用既有幂等字段，无数据库迁移。丢失响应先查询，不自动重做付费解题 |
| 运行入口 | 根`dev/start/build`改用Expo/RN Web；`scripts/api-proxy.cjs`仅转发固定本地API；`web-server.mjs`提供静态产物及安全响应头 |
| 原生工程 | Expo配置生成`apps/mobile/android`及`ios`（忽略、不手改）；`mobile:android/ios`复用3100端口Metro，需要相应SDK |

服务端 Pi、模型/供应商环境配置、独立Verifier、课程Skill、数据库与私有存储继续复用。Solver16轮、Verifier2次、120秒及工具预算不变；费用默认无限。没有把开发AGENTS或服务器密钥注入学生端。

## 实际检查结果

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过，lockfile同步，未开启传递安装脚本 |
| Expo `install --check` | 通过，Dependencies are up to date |
| `pnpm lint` | 通过，Pi导入/显式any/TS抑制边界检查 |
| `pnpm typecheck` | 通过，服务端/共享包/根测试及移动端严格类型检查 |
| `pnpm test` | **571/571**，58文件，确定性离线测试 |
| `pnpm test:integration` | **32/32**，随机隔离数据库与桶，本地提供商；原生身份、上传/提交/恢复/SSE/追问/取消/删除及跨owner/协议替换纳入验证 |
| `pnpm test:e2e` | **38/38**，桌面1440及移动390，另验证320窄屏及844×390横屏相机；使用本地demo和明确标注的展示fixture |
| `pnpm build` | 通过：服务端构建、Expo Web + Android/iOS Hermes导出、本地答案/字体资源存在性检查 |
| `CI=1 pnpm mobile:prebuild` | Android/iOS工程生成通过；不执行原生编译或CocoaPods安装 |
| 生成权限检查 | Android最终CAMERA声明存在，录音/广泛媒体库权限被移除；iOS有相机/照片说明，无麦克风/FaceID声明 |
| 客户端产物检查 | 12个导出文件未包含本机配置的私密凭据字节；KaTeX WOFF2内嵌，无CDN字体依赖 |
| 真实模型验收脚本 | 已适配RN的相册、裁切、题内追问、历史折叠和删除确认；语法检查通过，保留显式`--live`门控，本轮未执行付费路径 |

E2E入口为 `tests/mobile-e2e`，不是沿用历史Next测试数量。用户随后要求清理旧代码，原 `tests/e2e` 与 `apps/web` 已删除；其中11项仍适用的公式、裁切和分题单元测试迁入 `packages/client` / `packages/contracts`，保留断言并针对当前实现执行。没有把界面fixture当作真实模型解题成功。

浏览器覆盖：示例题经真实API上传/解题演示/SSE/追问/刷新/历史/删除；相机实际虚拟视频像素、释放流、拒绝权限转相册、迟到授权清理；伪造JPEG拒绝、旋转尺寸、裁切后才提交；大图缩放、按题更正与旧答案、知识点/步骤追问、多题隔离；SSE连接失败不重复提交、显式取消；未验证/澄清/拒答/错误/保存模式；HTML/危险链接限制、公式表格横向滚动、原题裁片和SVG。

运行日志（本机忽略文件）：`/tmp/solveflow-rn-unit.log`、`/tmp/solveflow-rn-integration.log`、`/tmp/solveflow-rn-release-e2e.log`、`/tmp/solveflow-rn-release-build.log`。截图位于 `.runtime/screenshots/` 的RN workspace、learning-content与rich-answer记录。

## 验收发现并修复

- 浏览器fetch被作为对象方法调用导致非法receiver：共享客户端固定独立函数调用，并补回归。
- Expo CSS未复制KaTeX相对字体：从锁定KaTeX包生成内嵌WOFF2，build检查本地资源完整。
- 相册插件配置误删Android CAMERA：统一相机权限说明，并检查最终manifest。
- 原题裁片在窄屏受网格最小宽度影响：修正minmax/min-width，放大可横向查看。
- Expo 57.0.5 Web相机取流失败仍通知ready、卸载后迟到流未停止：Web平台适配在真正可播放后启用拍摄，并关闭迟到流；不修改上游SDK。8项相机专项及最终全套回归通过。
- 网络不确定提交记录不能影响其他题：改为按session存储ID/摘要，确定拒绝释放记录，显式重试复用原key；恢复上次任务时保留当前输入。

## 依赖与产物

Expo57.0.22、RN0.86.3、React19.2.3、RN Web0.21.2；原生模块按已安装Expo兼容表精确固定，未升级Pi。移动包采用Expo要求的TS6.0.3，服务端TS5.9.3不变。新增Expo/RN模块为MIT，TS为Apache-2.0。依赖动机与来源见ADR0012。

当前三端组合导出目录约 **8.8MiB**，Android/iOS Hermes各约2.4MB，Web JS约1.8MB，本地DOM JS约1.8MB、内嵌字体CSS约369KB；这是未压缩开发验收产物统计，**不是APK/IPA下载或安装体积**。生成工程当前最低目标：Android API24（Android7），iOS16.4；不能据此承诺所有旧手机都支持。

## 使用与剩余验收

默认真实服务通过 `pnpm start` 在原地址 `http://127.0.0.1:3100` 运行，API健康检查 `http://127.0.0.1:3101/api/v1/health`；实际PID/模式/日志记录在 `.runtime/app-session.json`。服务恢复前检查活动任务数为0，保留原数据库、题目记录与费用账本。

- 当前Linux缺少Android SDK/adb/emulator，且无macOS/Xcode，未产生APK/IPA，未启动模拟器或真机。后续需编译并验证原生Camera/SecureStore/WebView桥接、字体、键盘、安全区、屏幕旋转、弱网、切后台和相册回收。
- 原生发行版需要在 `apps/mobile/.env` 配置手机可达的公开HTTPS API；根服务端`.env`不变。当前仅监听电脑回环地址，没有擅自开放公网。步骤见[移动客户端说明](../apps/mobile/README.md)。
- 原生与浏览器匿名身份独立，没有账号登录/跨设备同步；清除身份可能失去历史访问。提交恢复只保存ID和指纹，不持久化题目草稿；不确定提交后更改内容需要先确认旧任务。
- App正式图标、签名、商店材料与分发、PWA离线安装、真机可访问的生产服务尚未交付。解题仍依赖服务端网络；没有引入离线模型。
- M0未完成的安全项、完整学科准确率、生产MCP/隔离SymPy和公网验收，仍以既有技术计划为准。本次前端迁移不代替这些验收。
