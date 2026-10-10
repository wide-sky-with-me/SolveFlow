# SolveFlow

基于 Pi SDK 的拍照解题应用，Android 与 Web 共用 React Native / Expo。默认由设备直连用户配置的模型，本地保存题图和记录，无需部署 SolveFlow 后端。iOS 构建与模拟器验证见[操作指南](docs/cookbook/ios-simulator.md)。

支持相机/上传、裁切、批量解题、公式图示、同题追问和本地备份恢复。单题默认简洁答案，步骤、知识点和校验按需生成；批量任务自动独立核验。模型校验不保证答案正确。考试类型形成题目快照，Pearson 官方播放器仅作外部样卷来源。

## 运行

Node/pnpm 版本以 [package.json](package.json) 为准，使用锁定依赖：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

以命令输出的地址为准。首次进入应用设置，配置支持图片输入的 HTTPS 模型服务，显式选择 Chat Completions 或 Responses。原生密钥保存在系统安全存储；手工Web密钥仅在内存，模型服务需允许CORS。本地Web也可按[环境桥接指南](docs/cookbook/local-web.md)复用`.env`，真实密钥留在Node。历史可离线查看，新解题需要联网。

静态 Web、Android 打包、旧服务路径与验证命令见 [开发流程](docs/development.md)。内部测试 APK 不等于正式签名发布，备份不包含密钥；卸载或清除数据前应自行导出记录。

## 项目入口

- [当前架构](docs/architecture.md) 与 [文档导航](docs/README.md)
- [发布状态和未完成项](docs/project-status.md)，区分构建、浏览器、真机和模型实测
- [开发规则](AGENTS.md)、[变更流程](docs/cookbook/change-management.md) 与 [测试边界](docs/testing.md)

当前行为在所属子系统文档维护；决策原因在 `.agents/notes/` 按主题搜索；既有 ADR 和验收报告按原路径保存为历史证据。
