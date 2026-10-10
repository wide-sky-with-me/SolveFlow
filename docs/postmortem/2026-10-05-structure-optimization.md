# 代码结构与构建入口优化验收

日期：2026-10-05。

范围：源码边界检查、客户端公共子入口、移动工作区拆分及共享/服务构建；使用合成数据与离线供应商。

结论：四项结构优化完成；全量离线回归 927 项、浏览器功能 70 项与性能 20 项通过。类型、三端 JS/Hermes 导出、包内资源和管理检查通过；不代表 APK、真机或真实模型通过。

## 变更与处理

选择与兼容要求见[决策](../../.agents/notes/implemented/architecture/2026-10-05-source-and-build-boundaries.md)；当前代码导航归[架构](../architecture.md#代码职责)，构建责任归[开发流程](../development.md#构建范围)。未修改持久化格式、模型权限或既有产品断言。

## 验证结果

Node 24.19.0、缓存 pnpm 11.7.0；编辑前快照及日志位于 `.runtime/structure-optimization-2026-10-05/`。

| 实际命令/检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run --project offline tests/unit/boundary-check.test.ts --maxWorkers=2` | 新增场景初次 17 失败、9 通过；修复后 26 通过，退出 0；已包含在全量成绩中 |
| `pnpm build:shared` | 构建 contracts/client/agent 三包并生成学生资源，退出 0 |
| `pnpm build:server` | 构建 API 及依赖六包，不运行移动资源生成，退出 0 |
| `pnpm typecheck` | 实际执行新的 `build:workspace`、根类型检查及移动类型检查，退出 0 |
| `pnpm exec vitest run --maxWorkers=2` | 106 文件、927 项通过，退出 0；含公共子入口与兼容入口身份回归 |
| `EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 pnpm --filter @solveflow/mobile build` | Web 与 Android/iOS JS/Hermes 导出，退出 0；未编译原生二进制 |
| `node scripts/check-build.mjs` | 共享模块加载、本地 DOM/字体及三端资源检查退出 0 |
| 下方浏览器功能命令 | 桌面/窄屏 70 项通过，退出 0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:56809 pnpm test:e2e:performance` | 完整性能组 20 项通过，退出 0；构建、功能与性能顺序执行 |
| `pnpm lint` | 源码边界与文档检查退出 0 |
| `node --test scripts/test-project-docs.mjs` | 管理回归 20 项通过，退出 0 |
| `git diff --check` | 退出 0 |

```sh
SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:56809 pnpm test:e2e:functional \
  tests/mobile-e2e/workspace.spec.ts tests/mobile-e2e/navigation.spec.ts \
  tests/mobile-e2e/history-import.spec.ts tests/mobile-e2e/history-recovery.spec.ts \
  tests/mobile-e2e/storage-recovery.spec.ts tests/mobile-e2e/batch-solving.spec.ts \
  tests/mobile-e2e/exam-materials.spec.ts tests/mobile-e2e/result-states.spec.ts \
  tests/mobile-e2e/verification-coverage.spec.ts tests/mobile-e2e/correction-and-cancel.spec.ts \
  tests/mobile-e2e/formula-editor.spec.ts
```

初次边界失败日志经尾部打印包装，未保存 Vitest 的独立退出码，不将 shell 的 0 当作测试通过。修复后各命令保留真实进程退出码。离线子进程、回环与浏览器使用获准本机权限，不调用真实模型。

编辑前后核对保留 14 个操作、弹窗与启动函数的函数体；入口从 1003 行改为 46 行，状态、操作、页面与弹窗分别归属工作区。没有增加依赖或修改工具版本，原客户端根导出保留。性能组保留序列化零次、页缓存有界和绘制回退断言，不宣称性能提升或 Android 帧率。

浏览器仅连接本轮自建服务 PID 936962、URL `http://127.0.0.1:56809`；服务结束退出 0。临时 pnpm 包装与重构辅助脚本已清理；证据、快照和变更范围留在上述忽略目录。

## 未验证项与剩余风险

本轮未运行全部 228 项浏览器功能，仅执行上述 70 项及完整性能组；未执行远端 CI、数据库/对象存储集成、APK 编译/安装、原生 prepare、开发服务启动、真机或真实付费模型。工作区已有大量未提交内容，以本轮编辑前快照区分变更，没有提交、推送或部署。
