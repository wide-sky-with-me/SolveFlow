# 开发流程

从仓库根目录工作。Node 与 pnpm 的精确版本由 [package.json](../package.json) 的 `engines` / `packageManager` 指定；依赖使用 [pnpm-lock.yaml](../pnpm-lock.yaml)，安装策略在 [workspace 配置](../pnpm-workspace.yaml)。不要从旧验收报告复制版本号。

## 本地运行

1. `pnpm install --frozen-lockfile` 安装锁定依赖；没有修改依赖时不必重复安装。
2. `pnpm dev` 构建共享包并启动 Expo 开发服务；按终端提示按 `w` 打开 Web，地址以实际输出为准。
3. 设备及手工Web在应用设置中配置支持图片输入的模型，显式选择Chat Completions或Responses。手工Web模型服务需允许CORS，刷新后重填密钥；环境Web按下一步配置。
4. 使用已构建的Web或根.env模型时，按[本地Web指南](cookbook/local-web.md)选择入口、配置和更新步骤；Expo开发入口不读取环境桥接。完整三端导出见下方，JS/Hermes导出不是APK编译。

模型参数、安全存储与任务行为见 [设备运行](subsystems/device-runtime.md)。Android 构建和手机测试按 [打包指南](cookbook/android-release.md) 执行；iOS 在 Mac 按[模拟器指南](cookbook/ios-simulator.md)编译与验收。

## 构建范围

`build:shared` 生成受审学生资源并构建设备依赖的共享包；`dev` / `mobile:dev` 和根移动开发入口先执行它。`build:server` 只构建 API 及其依赖，不生成移动资源；`build:workspace` 构建全部非移动工作区并生成学生资源，供全量类型、测试和构建使用；同时启动 API 与 Expo 的 `server:dev` / `dev:demo` 也使用它。

`build:web` 导出 Web，`build:mobile` 导出三端 JS/Hermes 并检查包内资源；`build` 保留完整工作区与三端导出检查。这些命令不安装 APK、不启动服务或调用模型。

## 变更与验证

先读目标目录规则、实现与相关决策，明确验收，再做最小变更。初次接手或恢复上下文按 [AI 开发指南](cookbook/ai-development.md) 定位。公共行为更新所属当前文档；长期取舍按 [变更流程](cookbook/change-management.md) 留笔记。

- 文档检查：`pnpm docs:check`；检查器回归：`pnpm docs:test`。两者无需构建或模型凭据。
- 代码检查：`pnpm lint`（源码边界 + 文档）、`pnpm typecheck`。后者会先构建非移动工作区。
- 离线全量：`pnpm test`，包含单元与离线集成。按[测试分层](testing.md#入口与分层)选择定向入口；已完成 `build:workspace` 时直接运行 Vitest，避免重复构建。
- 依赖审计：`pnpm deps:audit` 联网检查完整锁文件，包含构建依赖；任何级别通告或审计服务失败均非零退出。修复必须核对已发布版本、实际消费方和兼容回归，不能把通告给出的范围当成已发布版本。
- 其他检查按 [测试规则](testing.md) 选择；完整命令以 `package.json` 的 scripts 为准，不维护平行命令全集。

[CI](../.github/workflows/ci.yml) 分为文档、依赖审计、离线代码与构建三个作业。审计不设忽略名单，也不以 `continue-on-error` 放行；现有未修复通告会保持该作业失败，具体状态见 [发布待办](project-status.md)。其余作业仍独立执行类型、单元与三端 JS 导出。CI 不提供模型凭据、不部署、不编译商店签名包，远端执行与本地通过分开报告。

保留服务路径仅在任务涉及它时启动，见 [服务说明](subsystems/legacy-server.md)。后台测试服务必须记录 PID/URL，结束后清理本次进程。
