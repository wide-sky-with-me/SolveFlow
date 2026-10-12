# 批次管理与单题历史误清空修复

日期：2026-10-10。

范围：共享设备运行时、Web浏览器桌面/移动视口，隔离IndexedDB、合成图片与假模型；保护用户正在使用的服务与真实数据。

结论：旧版确认单题清空误删批次；修改删除范围，并增加批次放弃、二次排序/移除与导入取消。客户端174项、运行时及相关定向114项、浏览器30项通过；已更新本地Web，原生安装包未验。

## 变更与处理

单题列表原调用全库removeAll；旧版隔离复现中，一张单题和两个批次的四张图全部被删除。现在按原始记录归属确定单题集合，并原子删除。未知归属记录和孤立诊断保留。批次相机原只有完成拍摄，没有整批放弃/编辑入口；现在相机与批次菜单均提供入口，删除前明确确认。

调整草稿可上下移动、移除；取消不修改保存记录，确认停止本批任务后一次提交。图像原文、保留题目的session与答案不变，位置重新连续编号；旧v1内联图仍可读取。保存失败或成员变化不部分写入，不自动重新调用模型。相机在调整/删除确认和导入预览期间释放摄像流，关闭相机后的迟到保存不开始解题。入队失败不再回退已保存图的数量。

## 验证结果

证据保存于忽略目录`.runtime/batch-management-2026-10-10/`，不包含真实题图、密钥或模型正文。

- 旧版复现：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:43779 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-management.spec.ts -g 'clearing single' --project desktop`，退出1；期望保留四张批次图，实际零条。`reproduction.log`与失败截图保留。
- 首轮定向单测：63项中62通过；新迟到结果夹具同时挂起两个模型却未释放被取消的夹具，超时。分离释放后63项通过，未放宽超时/断言。
- 扩大单测：114项中113通过；旧存储失败回归通过拦截repository.remove注入故障，新单题路径绕过该入口。恢复单题删除入口后六文件114项通过，退出0：`pnpm exec vitest run packages/client/src/local-batch-edit.test.ts packages/client/src/local-engine.test.ts packages/client/src/local-batch.test.ts packages/client/src/storage-recovery.test.ts packages/client/src/local-history.test.ts apps/mobile/src/runtime.test.ts --maxWorkers=2`。

- 客户端完整回归：`pnpm exec vitest run packages/client/src --maxWorkers=2`，18文件174项通过，退出0；与前述定向回归有重叠，不累计为新场景。
- 首轮浏览器22项中20通过；相机放弃场景在事务完成前直接读取存储，桌面/移动视口均提前断言。保留断言、改为等待存储提交后，两视口复测通过。`browser.log`与`camera-recheck.log`保留失败和复测。
- 最终浏览器：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:42063 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-management.spec.ts tests/mobile-e2e/batch-import.spec.ts tests/mobile-e2e/history-management.spec.ts tests/mobile-e2e/camera.spec.ts`，桌面1440与移动390两视口共30项通过，退出0。包含单题/其他批次保护、编辑取消/提交/刷新、导入移除/取消、失败重试、相机轨道释放、权限拒绝和迟到权限；新编辑页面两视口另检查按钮没有超出卡片，截图在证据目录。
- `pnpm build:shared`、`pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`及`pnpm --filter @solveflow/mobile exec expo export --platform web --output-dir ../../.runtime/batch-management-2026-10-10/web-final`均退出0。`pnpm lint`通过源边界与文档检查；首次文档超长和锚点错误已精简/纠正，未放宽门槛。
- 本地Web在17:51原子更新静态资源，`127.0.0.1:3100`实际页面哈希与导出一致，原服务未重启、旧资源保留，未写模型配置或用户历史。发布收据为`published.json`，测试服务PID/URL写在`test-service.json`并在交付前停止。

## 未验证项与剩余风险

本轮不调用真实付费模型，不构建/安装APK或iOS包；浏览器移动视口不代表原生相机验收。共享代码覆盖移动端，但实际原生安装包需要另行构建验证。编辑停止任务后不自动重放，保留待解题由用户手动继续；存储事务不支持时明确拒绝。用户真实历史未执行任何清空/删除测试。
