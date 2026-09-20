# SolveFlow RN 本地应用

App/Web 共用界面，直接连接设置页配置的模型。模型密钥不能放在源码或.env里。安卓使用SQLite与SecureStore，Web使用IndexedDB与仅内存密钥。无需部署SolveFlow后端。

从仓库根目录运行 `pnpm dev`，或 `pnpm build` 后 `pnpm start`。安卓包使用 `pnpm mobile:apk`，在应用设置内填写模型服务。详见[本地应用验收](../../docs/LOCAL_APP_ACCEPTANCE.md)及[架构决定](../../docs/adr/0013-local-device-agent.md)。

首次运行可跳过设置，离线拍照保存题目。已保存的答案、题图可离线查看；新解题、追问和连接测试需要联网。Web直连还要求供应商允许CORS。安卓切后台取消本次调用，不自动重做中断任务。
