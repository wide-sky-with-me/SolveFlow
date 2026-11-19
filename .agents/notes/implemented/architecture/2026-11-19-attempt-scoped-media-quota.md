# 考试图片存储配额按单场作答隔离

日期：2026-11-19。状态：implemented。范围：中心考试题图上传容量核算边界。

## 背景

中心考试实考与演练常复用固定学生账号（如 `student`、`student2`）。单场近百题的三变体题图（原图、模型图、缩略图）约占 330–660 MiB；原先按 `owner_user_id` 终身累加全部历史未删除题图并限制 1 GiB，导致账号跨两到三场考试后必然耗尽配额（线上 `student` 累计达 1,264.75 MiB），新开场次首题上传即返回 `HTTP 409`，而 `SOLVEFLOW_EXAM_EXTRA_MEDIA_ATTEMPT_ID` 每次只能手动放行单个 `attempt_id`。

## 决定

[题图上传](../../../../apps/exam-web/src/server/images.ts)保留账号级事务锁与学生单日 500 次上传次数上限，将容量核算从账号终身累加改为按当前 `attemptId` 统计：通过 `upload_intents` 与 `revision_images` 归属到当前 `attempt_id` 的图片根资产（`coalesce(parent_asset_id, id)`），按主键与 `media_assets_parent_variant` 索引去重汇总该场内处于 `quarantined`、`ready`、`deleting` 状态的三变体总字节数。默认每场上限仍为 1 GiB，命中 `SOLVEFLOW_EXAM_EXTRA_MEDIA_ATTEMPT_ID` 的单场放宽至 2 GiB。规则说明见[题图提交与断线恢复](../../../../docs/subsystems/managed-exam-submissions.md)。

## 放弃的方案

仅在每次新开考试时手工修改线上 `SOLVEFLOW_EXAM_EXTRA_MEDIA_ATTEMPT_ID` 不能消除跨场累计枯竭，且一旦累计超过 2 GiB 连单场扩容也会失效。单纯上调账号终身总上限（如 5 GiB）只能推迟撞线时间，仍会让历史归档场次阻塞后续新考试。

## 后果与限制

复用同一学生账号开启新考试时，历史已结束或归档场次的题图不再占用新场次的 1 GiB 上传额度；单场异常刷图仍受每场 1 GiB 容量与每账号每日 500 次上传双重约束。物理云盘总空间仍需结合冷备与归档策略独立监控，不因单场配额重置而代表无限磁盘。

## 验证

[考试管理集成与浏览器测试](../../../../apps/exam-web/src/server/exam-management.integration.test.ts)先复现历史场次满 1 GiB 导致新场次上传报错（Red），切换为单场核算后验证新场次正常上传、当前场次满 1 GiB 拦截并保留浏览器草稿预览、`extraMediaAttemptId` 仅对目标场次扩容至 2 GiB 及超 2 GiB 再次拦截；`pnpm lint` 通过。
