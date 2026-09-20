# SolveFlow Android / iOS App 可行性评估

**后续决定（2026-09-15）：用户已明确选择 App 与 Web 统一 React Native，已实施 Expo 通用客户端；本页保留早期路线比较，不再推荐按 Capacitor 继续开发。当前实现与验收见 [ADR 0012](adr/0012-react-native-universal-client.md) 和 [RN 迁移验收](REACT_NATIVE_ACCEPTANCE.md)。**

日期：2026-09-15。范围：现有实现审查与移动方案建议；本轮未安装原生框架、生成安装包或提交商店。

## 结论

可以做成两端 App。建议先验证 Capacitor 路线：复用 React 解题页面、KaTeX 公式、题内图示、知识点和同题追问，原生层负责拍照、选图及生命周期。Agent、独立校验、模型配置、数据库和私有存储继续放在服务器；App 解题仍需要网络。

这是结合仓库代码的工程判断，并非已经通过真机验收。Capacitor 官方定位为面向 Web 应用的跨平台原生运行时，支持 iOS、Android 和原生插件。[官方介绍](https://capacitorjs.com/docs)

| 路线 | 对现有项目的影响 | 适用判断 |
| --- | --- | --- |
| 继续 H5，补齐可安装 Web 体验 | 复用当前网页；继续验证各浏览器相机、权限和恢复行为 | 适合早期试用与分享入口，继续维护 |
| Capacitor + 共享 React 页面 | 页面和结果渲染可复用；新增原生相机、网络/身份适配与移动工程 | 当前优先建议先做技术样机 |
| React Native | 可共享契约和部分业务逻辑；DOM 页面/CSS 及公式图文呈现需要重新适配 | 当复杂原生交互成为主需求时再评估 |

React Native 使用原生平台组件，不能直接把现有网页组件视为已适配的原生界面。[React Native 组件说明](https://reactnative.dev/docs/intro-react-native-components)

## 现有能力与差距

- 已有：上传和裁切、网页摄像头预览、多题分组、原题复述和裁图、KaTeX、受控图表、知识点和同题追问、服务端任务持久化/SSE 重放。移动 viewport 自动化已有覆盖，仍需真机验收。
- 当前 `apps/web/app/page.tsx` 使用客户端 Workspace；`apps/web/next.config.ts` 通过 Next 服务器转发 `/api/v1` 并设置安全头。`apps/web/lib/client.ts` 和 Workspace 内 EventSource 使用同源地址。
- 当前身份是服务端签名的 HttpOnly / SameSite=Strict 匿名 Cookie；API 对写入检查固定 Origin。尚无跨设备账号体系，浏览器身份不会自动变成 App 身份。
- 仓库尚无 Android/iOS 工程，也没有完成可安装 PWA 的 manifest/Service Worker。当前电脑 localhost 地址不能作为手机发行版的服务器地址。

## 推荐结构与首轮要验证的问题

1. **把前端作为 App 本地资源打包。** 保留 Web 发布入口，先验证 Next 静态导出能否复用现有页面。Next 静态导出不支持服务器 rewrites、headers 等能力，因此 API 转发与安全策略需要显式迁移，不能只增加 `output: export` 就算完成。[Next 官方限制](https://nextjs.org/docs/app/guides/static-exports)
2. **单独设计 API 与身份适配。** App 使用受控 HTTPS API 地址；鉴权同时覆盖提交、SSE、历史和私有图片。需验证原生 WebView Cookie 行为，或设计受控的 App 会话凭据与原生安全存储；不能把 ownerId 当凭据、开放任意 Origin，或把 Token 放到 URL。EventSource 和普通 img 元素的鉴权能力要一起处理，不能只修改 fetch。服务端模型 key 和私有环境配置不打包到手机。
3. **采用原生拍照/选图入口。** Web 保留浏览器相机实现；App 入口返回统一的图片输入，接续当前裁切与确认。覆盖权限拒绝、取消、相片方向、iPhone 图片格式、超大照片缩放、内存与临时文件清理。官方 Camera 插件支持系统相机和相册；Android 相机期间可能发生 Activity 回收，需接入恢复事件。它不自动提供“小猿式自定义取景框”的全部能力，自定义实时取景/对焦/手电筒应先单独验证插件或原生桥接。[Camera 插件](https://capacitorjs.com/docs/apis/camera)
4. **恢复任务，而非依赖前台常驻。** 进入后台关闭不必要的相机和连接；回到前台读取 run 快照并重连事件。已有服务端任务不因断线取消，适合复用。上传中断与已提交任务分开处理，持久化幂等标识，恢复不能再次付费创建相同任务。系统杀进程和升级后的恢复需真机覆盖。
5. **专门打磨手机阅读与输入。** 处理刘海/底部手势区、键盘遮挡、Android 返回键、横屏、字体缩放、长公式局部横向滚动、大图放大、连续追问滚动定位。继续保留题内结构，减少无关操作信息。首版无需新增离线题库或离线模型，也不默认缓存私有题图/会话。

Capacitor 的 `server.url` 是开发热重载用途，官方明确不建议用于生产；建议交付本地前端资源加服务器 API 的方案。[配置说明](https://capacitorjs.com/docs/config)

## 实施顺序与验收门槛

第一步做最小双端样机：启动 → 原生拍照/相册 → 裁切 → 上传 → SSE → 公式/图示结果 → 同题追问。优先验证身份、私有图片和 SSE 能共同运行，避免只看到首页就宣布 App 可用。

第二步验证失败路径：相机拒绝、拍照取消、网络切换、上传中断、解题中锁屏、系统回收、重新启动、长公式与多题长页、键盘和返回操作。验收至少包括真实 iPhone 和 Android；Android 补低内存设备及无 Google 服务的选图路径。增加端到端与协议测试，仍保留 owner 隔离和幂等边界。

第三步再准备发布：独立品牌素材、权限用途说明、实际数据使用与隐私文案、签名与内测。苹果要求 App 具有足够的功能和 App 体验，仅包装网站不能视为已满足审核要求；具体是否通过由商店审核决定。[Apple 审核 4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality)

iOS 编译需要 macOS/Xcode（也可使用合适的 Mac 构建服务），Android 使用 Android Studio/SDK。当前 Linux 工作区可继续实现共享代码和服务端，但不能在这里宣称完成 iOS 原生构建和相机真机验收。[官方开发环境](https://capacitorjs.com/docs/getting-started/environment-setup)

以上为待实施方案；新框架和原生能力需在下一轮明确选定路线后引入。本轮没有变更现有架构或开放新的客户端权限。
