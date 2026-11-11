# main共享优化与文档提交前核对

日期：2026-11-11。

范围：main基于`5aa3c32`的既有共享优化工作区。本轮按用户要求整理并提交，没有新增产品功能或替换远程服务。

## 变更与处理

保留首响应/流停滞保护、诊断分类、秒表仅前台每秒更新、相同公式复用、44像素提示关闭目标及公开静态文本压缩。同步[运行](../subsystems/device-runtime.md)、[模型传输](../subsystems/model-transport.md)、[渲染](../subsystems/rendering.md)和[Docker](../cookbook/docker-web.md)说明，补齐原共享验收和Mac发布记录。中心考试的页面、数据库及迁移不进入main。

## main工作树恢复

原登记目录`/tmp/solveflow-main-20261109`不存在，不能据此把main当作没有未提交内容。保留原Git登记和索引，以`5aa3c32`恢复基础文件，再用本分支相同文件及适配内容恢复共享改动。恢复后752份运行源码逐项匹配11/09 Mac发布清单SHA-256，清单总摘要为`26c559a64f7f123ffde6aace6742ec43015acd7dcba7c10d0193384149a94302`。随后补回共享浏览器回归和当前文档，没有合入考试平台专属实现。

main复用现有锁定依赖的普通副本；9个共同lockfile importer、补丁配置和补丁正文一致。硬链接因跨文件系统失败，未修改源依赖。首次pnpm前置检查尝试重建依赖，因非交互退出；之后仅为本轮进程设置`pnpm_config_verify_deps_before_run=warn`，保留路径元数据告警。没有修改清单版本或锁文件；此路径不是干净安装验收。

## 验证结果

Node24.19.0、pnpm11.7.0；合成题和离线/回环夹具，以下命令退出码均为0。

- `pnpm typecheck`：工作区构建、根与mobile类型检查通过。
- `pnpm exec vitest run --maxWorkers=2 packages/agent/src/pi apps/mobile/src/components/second-clock.test.ts`：37文件426项通过。
- `pnpm test:web-container`：23项通过。
- `pnpm docs:test`：20项通过。

`pnpm lint`和`git diff --check`通过，退出0；日志放在主工作区忽略目录`.runtime/branch-commit-20261111/`。文档首检目录页超长，移除重复导航后复查；未提高门槛。没有重新运行浏览器、移动导出、原生或真实模型测试；[11/09共享验收](2026-11-09-shared-progress-ui.md)保留其原时间和范围。

## 未验证项与剩余风险

本轮不探活、不部署；Mac版本仍沿[11/09发布记录](2026-11-09-main-mac-progress-release.md)，跨网络完整交互未通过，不能以源码摘要恢复代替网络验收。复用依赖的构建不代表干净联网安装。最终提交哈希以Git记录为准，运行版本与源码状态由[项目状态](../project-status.md)区分维护。
