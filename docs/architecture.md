# SolveFlow 架构

SolveFlow 是学生端拍照解题应用。默认入口是 `apps/mobile` 的 React Native/Expo 客户端，Android、Web 与 iOS 共用界面；各平台实际验收范围见[发布状态](project-status.md)。模型在用户配置的 HTTPS 服务上执行，题图、会话和结果保存在本机。应用提供拍照/相册、裁切、单题或批量解题、按需学习内容、题内追问、分享和备份恢复。

## 运行链路

```text
apps/mobile 界面与平台适配
  → packages/client 本地任务、批量队列、仓库
    → packages/agent/mobile 受控 Pi 适配与业务编排
      → 用户配置的模型服务
  → Android/iOS SQLite / Web IndexedDB
```

共享协议由 [contracts](../packages/contracts/src/local.ts) 与 [HTTP/任务契约](../packages/contracts/src/http.ts) 定义；UI 不依赖 Pi 内部事件。`packages/agent/src/pi/` 是唯一 SDK 导入位置。受审学生资源单独生成，开发规则和决策笔记不进入模型资源发现范围。

默认设备路径的说明分为 [运行与模型设置](subsystems/device-runtime.md)、[存储与恢复](subsystems/storage.md)、[Agent 与验证](subsystems/agent.md)、[模型预算与传输](subsystems/model-transport.md)、[阅读渲染](subsystems/rendering.md)。这些页面维护语义，公共类型与容量常量仍由源码拥有。

## 代码职责

[应用入口](../apps/mobile/src/app.tsx)只组装主题、运行时启动与启动画面；[工作区](../apps/mobile/src/workspace/workspace.tsx)组装导航和覆盖层。[状态 hook](../apps/mobile/src/workspace/use-workspace-state.ts)拥有订阅、恢复与阅读就绪，[操作 hook](../apps/mobile/src/workspace/use-workspace-actions.ts)拥有照片、提交和删除流程；[页面](../apps/mobile/src/workspace/pages.tsx)与[弹窗](../apps/mobile/src/workspace/dialogs.tsx)消费同一工作区状态，切换页面不卸载当前题目。

[客户端公共入口](../packages/client/package.json)按责任选择 `local`（本地引擎与存储）、`remote`（保留服务的 HTTP/SSE）、`learning`（共享学习上下文）和 `presentation`（展示与编辑辅助）；根入口保留兼容。API 只复用 `learning`。错误类型由同一模块导出，不因入口不同改变类型身份。

[源码检查](../scripts/check-boundaries.mjs)约束工作区依赖方向、设备/共享核心的 Node 导入和跨包私有文件导入；测试允许使用私有源与 Node 夹具，Pi 导入限制仍适用。移动 Agent 的传递依赖另由[打包器](../scripts/bundle-mobile-agent.mjs)核对，不以源码检查代替产物检查。

## 保留的服务路径

`apps/api` 提供 Hono 路由和 worker；`packages/db` 使用 PostgreSQL/Drizzle，上传存于私有对象存储；`packages/config` 管理服务环境。此路径通过 `server:dev` / `server:start` 显式启动，默认设备应用无需它。服务端身份、幂等、租约、SSE 与终态事务见 [服务语义](subsystems/legacy-server.md)。

原生模型密钥与服务端 `.env` 互不注入；Web 可显式启用[本地环境桥接](subsystems/device-runtime.md#模型与考试)，由回环 Web 服务转发固定角色请求，真实密钥不进入浏览器。设备历史与服务数据库没有自动迁移通道。服务专属数据库、对象存储和 Node 配置不能打包到客户端。

## 产品边界

单题以简洁答案开始，详细步骤、知识点、校验按需生成并缓存；批量任务独立核验。考试背景保存为题目/批次快照，已有题目不会被默认设置改写。Pearson 等官方播放器只用于外部展示样卷，SolveFlow 接收相机/相册题图，不嵌入播放器或题库。

教学步骤与校验结果是面向学生的输出；模型内部 thinking 不公开。未验证、超时、失败和澄清有独立状态。工具授权、预算与内容限制由代码和共享策略执行，图片文字或模型输出不能扩权。

研发导航见 [开发流程](development.md)，验收证据与生产缺口见 [发布状态](project-status.md)。架构选择的原因从 [.agents/notes](../.agents/notes/README.md) 按主题检索，历史规划不作为实现清单。
