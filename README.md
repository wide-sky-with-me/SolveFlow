# SolveFlow

基于 Pi SDK 的拍照解题应用，Android 与 Web 共用 React Native / Expo。当前默认是**设备直连模型、本地保存数据**：在设置页填写模型服务地址、模型名及密钥，无需 SolveFlow 后端或域名。iOS 原生构建暂不推进。

题目复述、原题局部图、公式、结构化图示、知识点和题内追问继续复用原实现。独立校验由本机编排强制执行。当前真实状态和限制见 [本地应用验收](docs/LOCAL_APP_ACCEPTANCE.md)，架构见 [ADR 0013](docs/adr/0013-local-device-agent.md)。旧服务端数据和配置保留，不自动迁移。

## 运行

Node 24.19.0、pnpm 11.25.0。

```sh
pnpm install --frozen-lockfile
pnpm dev
# 或构建后运行静态网页
pnpm build
pnpm start
# 本机已有 Android SDK，可生成内部测试 APK
pnpm mobile:apk
```

网页地址默认 http://127.0.0.1:3100 。首次进入设置页；仅支持兼容 Chat Completions 的 HTTPS 模型服务，解题模型需支持图片和工具。Web 直连要求供应商允许 CORS，密钥刷新后需重填。安卓密钥使用系统安全存储。历史记录可离线查看，新解题需要联网。

安卓安装包在 `.runtime/artifacts/solveflow-arm64-local.apk`。内部测试签名，不是商店发布签名；生成包与真机验收分别记录。卸载/清除数据会丢失本地题图和记录，暂无备份导出。

## 验证

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# 启动静态 Web 后，执行本地应用浏览器回归
pnpm test:e2e
```

纯测试使用合成数据和明确的模型夹具。真实模型调用需 opt-in。旧服务端命令保留为 `server:dev` / `server:start`（当前已停止）；数据库集成测试仍使用隔离DB/桶。现有浏览器回归已迁到本地存储与直连模型协议，保留相机、分题、公式图示、安全渲染及取消断线断言。

## 设计与记录

- [当前技术设计](docs/TECHNICAL_DESIGN.md)
- [RN 架构决定](docs/adr/0012-react-native-universal-client.md)
- [RN 迁移验收](docs/REACT_NATIVE_ACCEPTANCE.md)
- [Android/iOS 安装包构建](docs/NATIVE_PACKAGING.md)
- [本地配置](docs/LOCAL_SETUP.md)
- [模型配置](docs/MODEL_SELECTION.md)
- [兼容性与各轮实际测试](docs/PI_COMPATIBILITY.md)
- [M1 真实模型记录](docs/M1_LIVE_ACCEPTANCE.md)
- [实施范围](docs/IMPLEMENTATION_PLAN.md)
- [费用策略](docs/SPEND_LEDGER.md)
