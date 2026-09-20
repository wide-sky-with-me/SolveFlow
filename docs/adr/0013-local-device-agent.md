# ADR 0013：本地数据与设备直连模型

- 日期：2026-09-15
- 状态：用户已接受，实施与验收见 LOCAL_APP_ACCEPTANCE.md

## 决定

用户明确选择“手机直连模型，完整迁移为本地应用”。这取代 ADR 0012 中客户端依赖 Hono API、服务端凭据与服务器存储的默认运行方式。Android 与 Web 继续共用 RN 界面；iOS 原生构建暂停。既有服务器、数据库、私有题图及环境文件保留，不删除历史数据、不自动导入设备。

App 内提供解题与独立校验模型设置：供应商标识、完整 Base URL、模型引用名、密钥、上下文容量、输出上限及 token 参数兼容开关。首先支持当前工程已有的 OpenAI 兼容 Chat Completions 协议；不硬编码真实供应商/型号、不自动 fallback。默认校验使用同一连接的独立调用，可以单独设置。配置须由用户在本机填写，不将服务端 .env 注入安装包。

Pi 仍负责模型/工具循环。移动适配位于 packages/agent/src/pi/mobile.ts，使用同版本 pi-agent-core 0.85.1 的 Agent 与 pi-ai 0.85.1 的协议适配，复用原业务 Solver→Verifier→最多一次修正。没有自写循环、第二套 Agent 框架或 Fork 上游。编码代理专用 pi-coding-agent 的 Node ResourceLoader/worker/file 设施不进入 App；构建时从显式受审目录生成静态 Skill 清单及正文，模型根据描述按需 read。路径只能指向内嵌 /skills/ 文件，不能访问设备其他数据。

Metro 无法直接解析 Pi 公共入口中的动态 import，因此使用已锁定 esbuild 0.28.1（MIT，既有传递依赖提升为构建依赖）裁剪移动入口，再由 Metro 编译。裁剪前校验依赖图，拒绝 coding-agent/数据库/服务端配置；构建定义 process.env 为不可变空对象，凭据仅通过运行时参数传入。生成文件在忽略目录，不手改上游。

当前工具是 read 与受限 calculate，包含数学、画图、经济、物理、化学、生物等原有受审 Skill。图示继续使用结构化 SVG，公式使用本地 KaTeX。现有未通过隔离验收的 Python/MCP/搜索能力不伪称可用。工具最多16次（read 8、业务8），Solver最多16轮，Verifier最多2次，总时限120秒，JSON语法修复全run一次。原图在独立校验时重新提供；只保留公开教学结果，不保存 Pi 内部 transcript/thinking。

## 本地持久化与生命周期

Android 使用 expo-sqlite 57.0.3（Expo 57 对应版本、MIT），WAL 与参数化语句；每题原图和会话一起原子写入一条记录。Web 使用 IndexedDB 原子事务，navigator.locks 保证同源仅一个活动 App 页面。上限100题、每题10轮、规范化JPEG最大4MB。采用版本化记录，旧服务器的会话协议仅复用为结果展示数据结构，previewUrl/expiresAt 在本地不作为网络请求或删除策略。

安卓密钥由 SecureStore 保存，配置指向两组交替凭据槽，先写新密钥再原子切换配置，避免半次保存造成旧地址搭配新密钥。Web 密钥只在当前页面内存，刷新需重填；非秘密设置和题目持久化。Android关闭系统自动备份，不主动同步或上传历史。

调用前先保存 queued 状态；重复点击只创建一个执行。初版应用切到后台主动取消模型请求；Android 已按 2026-09-17 用户授权改为前台服务保护同一任务，见 [ADR 0014](0014-android-background-solving.md)。系统杀进程后，重开将非终态标为 WORKER_LOST，不自动重放收费调用。取消后迟到结果不能覆盖 cancelled。纯离线可读取和删除历史、保存题图；新解题需要联网向用户选择的模型服务发送题图和必要上下文。清除应用数据、卸载或清除浏览器存储会丢失本地记录，尚无导入/导出备份。

## 网络与安全范围

只接受无URL凭据/查询参数的 HTTPS 模型地址；SDK请求只能POST到所配置Base URL的 /chat/completions，禁止重定向与Cookie，禁自动重试，响应流最大1MB，最终JSON最大32KB。Web需要供应商允许CORS；不开放绕过CORS的公共代理。静态站CSP仅允许HTTPS连接，图片和脚本仍限本地/受控data URI。

学生内容策略、独立校验和安全渲染保持。个人设备运行不具备服务器多租户或防设备所有者篡改的安全承诺：设备用户可以修改自己安装的软件。旧服务端的owner和权限不变量继续约束旧服务端路径。

## 验收

必须分别记录离线Pi循环、存储中断与取消、RN Web浏览器、Android编译、APK检查、真实供应商和安卓真机。构建成功不等于真机拍照/SQLite/WebView已验收。当前范围不包括iOS签名、商店发布、自动跨设备同步、模型本体离线运行。

依据：[Pi官方源码](https://github.com/earendil-works/pi)、[Expo本地存储](https://docs.expo.dev/develop/user-interface/store-data/)。兼容性以本地锁定0.85.1/57.0.3的代码和实际构建为准。
