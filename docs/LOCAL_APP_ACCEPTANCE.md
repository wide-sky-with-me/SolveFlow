# 本地直连应用验收（2026-09-15）

> 最新真机结果：0.1.3已覆盖安装到用户iQOO Neo9（Android 16），实际验证三次冷启动、历史解答的公式/正文/答案、知识点展开和原生追问输入桥接；本次未发送模型请求。0.1.2剩余时序故障与修复细节见[真机验收](ANDROID_ANSWER_FIX.md#013-真机修复与验收)。

> 2026-09-16后续：用户确认0.1.1已能完成解题，但正文没有展示。已修复安卓DOM初始注入的转义问题并构建0.1.2，实际APK答案资源测试通过，仍待真机复核。最新安装包和验证边界见[答案展示修复](ANDROID_ANSWER_FIX.md)。

> 2026-09-16：用户首次真机试用发现“连接测试成功、解题立即失败”。已复现并修复原生AbortSignal兼容问题，最新APK/验证结果见[安卓修复记录](ANDROID_SOLVE_FIX.md)；下文0.1.0产物、哈希和服务进程是历史记录。

用户选择手机直连模型并本地保存全部题目数据，决定见 [ADR 0013](adr/0013-local-device-agent.md)。默认入口已切换，不再要求 SolveFlow 后端地址。iOS原生构建暂停。

## 实现

- RN设置页：自定义HTTPS模型服务、供应商标识、型号引用、密钥、上下文容量、输出上限、token兼容字段和单独校验模型；提供显式文本连接测试及清除密钥。
- Android SQLite/安全存储，Web IndexedDB/页面内存密钥。题图和完整公开结果按题原子存储；默认100题、每题10轮。配置采用交替凭据槽，不将服务器.env复制到设备。
- 同版本Pi Agent核心在设备执行，内嵌受审Skill按需read、受限calculate，保留独立Verifier、一次修正、内容策略、预算和取消。没有临时后端或协议模拟器参与实际产品运行。
- 原题复述、裁切图、KaTeX公式、结构化图示、知识点及每题持续追问沿用RN界面。未解答的保存照片也可以删除。
- 中断任务不重放；初版切后台取消，Android 0.1.14 已按 [ADR 0014](adr/0014-android-background-solving.md) 改为前台服务保护任务，实测状态见[后台验收](BACKGROUND_SOLVE_ACCEPTANCE.md)。离线查看/删除历史及保存题图可用，模型解题需联网。
- 默认 `pnpm dev/start` 仅启动RN Web。原服务端入口保留为 `server:dev/server:start`，原数据库和图片未删；不自动迁移旧服务器历史。

## 验证范围

移动Pi入口先通过浏览器打包探针。Metro不支持上游通用入口的动态导入，采用esbuild裁剪移动入口，没有修改或升级Pi。进一步检查Expo/RN源码发现全局Response不能接收ReadableStream，改为保留Expo响应及其原生方法，仅代理受限body；对应回归已补齐。

单元回归覆盖配置地址限制、真实Pi Skill/计算循环、独立校验原图、FAIL后一次修正、策略拒绝、16轮上限、取消迟到结果、本地写入失败不派发及中断恢复不重放。端到端测试使用明确的合成题图和模型协议夹具，覆盖桌面/移动布局、相机像素与释放、完整本地问答/知识点/纠错/重试、IndexedDB重开、密钥不落数据库、第二标签页锁、图文公式及XSS边界。

本轮没有真实供应商调用。文本连接测试是设置页中的显式操作；通过文本测试不代表图片、工具和整题解答已验证。没有安卓实体设备或模拟器运行验收；APK编译不能冒充原生相机、SQLite、WebView和真实模型全链路通过。

## 仍需注意

- 首次安装需在设置中填写有效模型配置，不能直接沿用旧编译检查APK。
- Web密钥刷新后需重填，供应商必须允许CORS；安卓不依赖浏览器CORS。
- 初版 App 要求前台解题；Android 后台支持的最新进展见上述验收。暂无备份导出、服务器历史导入或跨设备同步。
- 模型本体仍在供应商运行；“本地应用”指执行编排和数据存储在设备，不代表离线模型推理。
- 当前工具不含未验收的Python隔离服务、搜索或MCP。旧服务端M0安全未完成项不因此变成通过。

## 本轮实际结果

- `pnpm typecheck`、最终根/移动端类型检查及 `pnpm lint` 通过。
- `pnpm build` 通过：Web、Android/iOS Hermes、本地DOM页与字体完整；iOS仅代码导出，没有原生签名构建。
- 最终 `pnpm exec vitest run`：**585项 / 61文件通过**。
- `pnpm exec vitest run --config vitest.integration.config.ts`：**32项通过**，使用隔离DB/桶，不是本地SQLite真机测试。
- 全量浏览器回归 **44项通过**；随后新增生产CSP下Pi读取Skill与calculate执行 **2项通过**，合计46项当前用例均已执行通过。
- `pnpm mobile:apk` 实际编译两次成功，最终一次1分53秒。
- APK：`.runtime/artifacts/solveflow-arm64-local.apk`，**40,783,774字节（约40.8MB）**，ARM64内部测试签名。
- SHA256：`e595c0dd0b7680d5af829a2e39879ffd26cc15d9a68cb84f5def442998e41f76`。
- APK v2签名通过，包含SQLite原生库、Hermes、内嵌答案DOM与字体，Android `allowBackup=false`。逐项解压扫描未发现本机模型密钥、数据库连接或随机私密凭据，也无.env文件。扫描的公开S3默认用户名与本地数据库名称同为solveflow-local，核对为公开标识碰撞，未作为秘密泄漏。

主要日志：`/tmp/solveflow-local-{build,typecheck,final-tests,integration,e2e-all,csp,apk-final}.log`。最终安装包报告：`.runtime/artifacts/android-local-build-report.json`。

首次单元测试在沙箱内因禁止回环监听失败，取得宿主测试权限后全量通过。首次相机回归遇到“权限按钮检查后自动消失”的测试竞争，改为同一次DOM操作处理可见授权按钮，保留拍摄像素、无麦克风、流释放及迟到授权断言，最终全部通过。

冻结安装 `pnpm install --frozen-lockfile --ignore-scripts` 通过。离线安装因既有AWS依赖的安全元数据缓存缺失而失败，联网仅刷新校验缓存后通过，lockfile未解锁或升级。

当前网页预览已切换为纯本地应用：http://127.0.0.1:3100 ，HTTP200、CSP允许HTTPS模型连接；旧API/worker已停止，原数据库/存储容器与内容保留，3210临时测试服务已关闭。运行状态见 `.runtime/app-session.json`，日志 `.runtime/service-local-app.log`。


2026-09-16增量：0.1.6新增本地收藏元数据 `favorite.<sessionId>`（schemaVersion 1），旧题目无需迁移；取消收藏不删除题目，确认移除则同时删除题图、解答与收藏。历史和收藏页共用本地公式渲染，详见[验收记录](HISTORY_FAVORITES_ACCEPTANCE.md)。
