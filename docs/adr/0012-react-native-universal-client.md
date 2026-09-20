# ADR 0012：React Native / Expo 统一 Android、iOS 与 Web

- 日期：2026-09-15
- 状态：已接受、通用客户端已实施；原生编译及真机验收待完成

## 决定

采用 `apps/mobile` 内的 React Native + Expo 通用客户端，Web 使用 React Native Web。主入口 `pnpm dev/start/build` 转到该实现；旧 Next 实现已移除，前端只维护通用客户端。原生导航、拍照、裁切、历史、进度、删除、更正和追问统一使用 RN 组件。

后端继续使用现有 Hono、Pi、PostgreSQL 与私有存储。服务端模型/供应商配置仍从服务端环境读取，16轮 Solver / 2次 Verifier 和工具权限不变。不引入第二套 Agent 框架或客户端模型密钥。

公式/图文解答使用 Expo 官方 DOM 组件机制，复用 KaTeX、React Markdown 和受控 SVG 图示。该局部渲染器和资源随 App 打包，不加载远程页面；Web 直接渲染同一 DOM 内容。原生组件负责题目边界与输入；避免每个公式建立一个独立 WebView。历史答案可展开，默认展示最新解答以控制移动内存。

## 旧实现清理（2026-09-15）

用户在RN迁移验收后要求清除旧代码。移除 `apps/web`、原 `tests/e2e`、Next/Tailwind依赖、旧构建产物及专用配置；11项仍有效的回归迁入共享包，裁切坐标断言适配当前Expo坐标字段。保留历史验收记录及仍用于已存题目的兼容逻辑。

## 身份与网络

Web 继续同源 HttpOnly / SameSite=Strict Cookie 与 Origin 校验。新增原生 `POST /api/v1/native/bootstrap`，必须没有 Origin、没有浏览器身份 Cookie，并带固定 `X-SolveFlow-Client: native-v1` 标识。这个标识只区分协议，不代表认证；后续操作必须使用服务端签名的原生 Bearer 凭据。

原生凭据采用独立 HMAC purpose，不能与浏览器 Cookie 互换，30天过期。bootstrap 回复的凭据仅保存在 SecureStore；不进入URL、DOM组件、日志或模型。未增加账号登录/跨设备同步，手机身份与原浏览器身份仍独立。所有图片、历史、任务、SSE、取消和删除继续校验 owner。无新增 CORS 放行。

原生发行版服务地址只接受 HTTPS。开发版允许受控本地 HTTP 地址，由 `EXPO_PUBLIC_API_URL` 配置；这里只能放公开API域名。Web 使用当前页面同源 API，通过固定 localhost 代理连接后端，不允许客户端指定代理目标。

共享 `packages/client` 提供运行时 schema 验证、身份传输、受限 SSE 解码、状态快照恢复、题目分组和提交幂等。新增只读 `GET /sessions/:id/submissions/:key` 查询原幂等请求对应的任务，以恢复丢失的提交回复；不重新派发模型。沿用现有数据库字段，无迁移。

## 生命周期与图像

前台通过 Expo fetch 流式读取 SSE；后台停止客户端流，返回后读取持久化快照并续接。连接最多重试8次，之后保留手动刷新；断线不自动取消、不自动重做付费任务。

原生相机使用Expo Camera；Web相机使用小型 `getUserMedia` 适配，均不请求麦克风、不录像。锁定Expo相机Web实现存在取流失败仍发就绪、关闭后迟到流未释放的问题，因此在平台适配层补齐取消清理，不修改上游包。相册选择、拍摄结果统一到图像处理适配层。使用 SDK 已发布的 ImageManipulator 上下文 API 裁切/旋转/压缩成JPEG，服务端再次校验、去EXIF、私有存储。原生相册采用系统选择器，处理 Android 选择器回收恢复；不请求整个媒体库的广泛权限。清理应用生成的临时图像，不删除用户原始相册文件。

原题图片由经过授权的客户端读取为有界内存图片再交给解答组件，组件不拿身份凭据。Markdown 禁 raw HTML、外部追踪图及危险链接，KaTeX trust=false，保留宏展开限制。关闭 DOM 原生模块通用桥接、共享Cookie与任意文件/外部页面跳转。

## 依赖与兼容

按安装版本的 `expo/bundledNativeModules.json` 对齐依赖，不将 latest 标签误当兼容组合：Expo 57.0.22 / RN 0.86.3 / React 19.2.3 / RN Web 0.21.2；原生相机、裁切、安全存储与 WebView 均精确固定。新增移动包使用 Expo 要求的 TypeScript 6.0.3（Apache-2.0）；既有服务端 TS 5.9.3 和 Pi 版本未升级。Expo/RN/原生模块使用 MIT 许可。传递依赖安装脚本保持关闭。

构建检查发现 Expo CSS 相对路径不会自动带上 KaTeX 字体，因此通过可重现脚本生成含本地 WOFF2 字体的 CSS，生成文件不入库。原生插件配置额外检查最终 Android CAMERA 权限，防止相册插件将其移除；禁用不需要的录音和 Face ID 声明。

## 验收边界

必须分别记录：TypeScript、离线测试、真实DB/私有存储集成、RN Web E2E、三端代码导出、原生工程生成、原生编译、真机验收。代码导出/工程生成不代表 APK/IPA 或商店发布完成。后续Android SDK已补齐并完成ARM64 APK原生编译；未配置公开API，产物仅为编译验证包。Linux无Xcode，iOS仍需Mac或已绑定的EAS云构建和Apple签名；真机验证未完成。见[原生打包](../NATIVE_PACKAGING.md)。

详情和实际命令见 [RN 迁移验收](../REACT_NATIVE_ACCEPTANCE.md)。

## 官方依据

- [Expo monorepo](https://docs.expo.dev/guides/monorepos/)
- [Expo DOM components](https://docs.expo.dev/guides/dom-components/)
- [Expo fetch](https://docs.expo.dev/versions/latest/sdk/expo/#expofetch)
- [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/)
- [ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/)
- [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
