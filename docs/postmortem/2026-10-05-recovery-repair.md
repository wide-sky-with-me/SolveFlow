# 损坏补图与备份合并修复

日期：2026-10-05。

范围：客户端仓库、记录维护界面、合成 JPEG / 隔离浏览器存储，以及用户授权的 npm 依赖审计。未提交、推送、部署或调用真实模型。

结论：两处恢复问题已修复，877 项离线测试和 20 个桌面/移动浏览器场景最终通过。依赖审计仍有 2 high，不能声明漏洞已清除。

## 变更与处理

- [维护页](../../apps/mobile/src/components/history-maintenance.tsx) 原先只为原图和元数据损坏提供恢复按钮，补图损坏虽然底层可修复，界面没有入口。现在明确显示“补充材料”，允许用户确认从备份恢复整题。
- [仓库](../../packages/client/src/local-repository.ts) 普通导入原先要求全部现有元数据可读。现在隔离 LocalDataError，保留损坏与无效记录键、容量和原始字节，继续合并其他题目。有效元数据、诊断键和坏题有效摘要仍预留已知编号，I/O 失败不跳过。原因及限制见[决策](../../.agents/notes/implemented/storage/2026-10-05-import-with-damaged-records.md)，当前语义见[存储](../subsystems/storage.md)。
- 本轮不改依赖或锁文件。`pnpm audit --audit-level=low --json` 退出 1，报告 node-forge 1.4.0 与 braces 3.0.3 两条 high。注册表的当前发布版本仍分别为 1.4.0 / 3.0.3；[node-forge 通告](https://github.com/advisories/GHSA-86w9-cpqp-85rv)及[braces 通告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)均标记没有补丁版本。审计建议的版本下界不能当成已发布版本；不忽略通告，也不自行改密码学实现。

## 验证结果

| 命令/场景 | 实际结果 |
| --- | --- |
| 修复前 `pnpm exec vitest run packages/client/src/local-history-import.test.ts --maxWorkers=2` | 3 失败 / 18 通过，退出 1；直接复现坏记录阻断，以及需保留的诊断与批次冲突检查 |
| 修复前 Playwright `storage-recovery.spec.ts --project=mobile --grep 'damaged material'` | 1 失败，退出 1；等待恢复按钮超时 |
| 修复后相关三文件 Vitest | 47 通过，退出 0；随后增加批次名称损坏场景，导入单文件 22 通过，退出 0 |
| `pnpm typecheck` | 退出 0，含共享包构建；本次使用 Node 24.21.0 / pnpm 11.7.0 |
| 项目指定 Node 24.19.0 下 `pnpm typecheck` | 退出 0；测试导航补齐后 `pnpm exec tsc --noEmit` 也退出 0 |
| `pnpm exec vitest run --maxWorkers=2` | 103 文件 / 877 项通过，退出 0，允许本机回环与测试子进程 |
| `pnpm --filter @solveflow/mobile build:web` | 退出 0；仅 Web 导出，未编译 APK |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3188 pnpm exec playwright test tests/mobile-e2e/storage-recovery.spec.ts tests/mobile-e2e/history-import.spec.ts tests/mobile-e2e/history-export.spec.ts tests/mobile-e2e/exam-materials.spec.ts` | 18 通过 / 2 失败，退出 1；两项补图已成功恢复，但新用例在重载后没有从历史列表打开题目，等待材料按钮超时 |
| 同一 URL 下 `pnpm exec playwright test tests/mobile-e2e/storage-recovery.spec.ts --grep 'damaged material'` | 补齐历史列表导航后，桌面/移动两项均通过，退出 0；断言仍验证材料实际可打开，未降低超时或删除断言 |
| `pnpm lint` / 最后文档更新后的 `pnpm docs:check` | 退出 0；源码边界、决策反链和冻结文档检查通过 |
| npm 审计与两个包的 `pnpm view <包> version --json` / `versions --json` | 审计退出 1、2 high；版本查询退出 0，完整列表不含 node-forge 1.4.1 / braces 3.0.4 |

前述复现和初步检查使用 Node 24.21.0；后续完整回归使用项目指定 Node 24.19.0 / pnpm 11.7.0。浏览器最终通过 20 个不同场景，补图复测不增加场景数。证据、修改前快照和审计 JSON 位于忽略目录 `.runtime/recovery-repair-2026-10-05/`；本轮专用服务为 `http://127.0.0.1:3188`，PID 1867958，验收后已关闭。

## 未验证项与剩余风险

尚未编译 APK、安装手机、验证 Android SQLite 故障或执行真实模型、服务数据库集成。损坏元数据内不可识别的隐藏引用不能提前校验，后续修复仍可能遇到编号冲突；现有文档键和健康题目不覆盖。两条构建依赖 high 尚无已发布修复，保留为正式发布阻碍。
