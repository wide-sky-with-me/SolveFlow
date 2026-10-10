# Android 存储故障验收

本流程使用独立的 `com.solveflow.storageprobe` APK 和合成题目，复用正式应用的 SQLite 文档适配、LocalEngine、备份分卷和原生文件读写。不会卸载、清库或强杀 `com.solveflow.app`。模型由计数回调替代，测试包移除网络权限。

## 操作

1. 按 [Android 构建](android-release.md) 准备锁定版本的共享包、SDK 和已生成原生工程。运行 `pnpm build:shared`，确保测试 APK 引用的客户端 dist 是当前版本。
2. `pnpm test:android:storage:build`：将原生输入复制到 `.runtime/android-storage-probe/`，设置独立包名、入口和 scheme；正式 `apps/mobile/android` 保持不变。探针没有 DOM 页面，复制工程不运行产品 DOM 资源钩子。
3. `pnpm test:android:storage -- --device=<明确的ADB序列号>`：校验 APK 包名和无网络权限后安装，按固定白名单执行。设备首次安装可能要求本人身份验证，不能关闭安全设置或绕过；系统验证未完成时不能报告测试通过。
4. 脚本在 `.runtime/storage-device-<时间>/results.json` 保存实际阶段结果和内存采样，失败返回非零。全部通过后卸载独立测试包，其私有数据库和临时备份随包清理；失败时停止探针并保留合成数据供排查，排查完成后仅卸载 `com.solveflow.storageprobe`。

系统文件选择器另用 `--with-saf` 追加完整流程，或 `--saf-only` 单独重测。选择或新建专用空目录 `SolveFlowStorageProbe`，导出后在文件选择器选中刚生成的 `solveflow-storage-probe-*.ndjson`。脚本会校验 63 题及全部哈希，删除自己创建的文件；不要选择个人备份。默认 12 阶段不需要操作文件选择器。

测试需要至少 2 GiB 空闲空间，合成库及备份容量有界。脚本只接受明确设备，不接受任意应用包名、SQL 或删除路径。强杀只针对探针，检查其进程确实结束后才继续重启验收。无需读取正式应用的密钥或私有数据库。

## 证据含义

- SQLite 通过 `max_page_count` 返回真实 `SQLITE_FULL`，检查事务原子性和模型结果仅重试保存。只限制测试连接，不占满手机文件系统。
- 在事务提交前、任务执行中、部分导入提交后和答案未保存时强杀测试进程，重启检查完整性、中断状态、不自动重放及重复导入补齐。
- 大备份使用可解码合成 JPEG，以正式 128 MiB 阈值分卷；乱序和重复恢复后逐题比较题图、答案、收藏和诊断的 SHA-256。
- 原生文件测试覆盖截断拒绝、取消回滚和临时文件清理。默认在私有目录验证 72 题、超过 128 MiB 的两卷；可选 SAF 流程通过系统选择器写入、选取并恢复一卷超过 120 MiB 的文件，不代表所有厂商或云盘文件提供方。

`results.json` 的内存值是定期 PSS 采样最大值，不是连续峰值或无泄漏证明。数据库容量上限不能代替整个文件系统 ENOSPC、设备掉电或介质故障。仅在内存中的未保存答案在强杀后丢失，是当前明确限制；不得把该预期结果描述为跨进程保全。

正式 APK 资源检查拒绝探针 scheme、状态文件和专用标识，避免把故障入口带给学生。测试入口与故障插桩仅在 `apps/mobile/storage-probe/` 中，产品入口不引用它们。
