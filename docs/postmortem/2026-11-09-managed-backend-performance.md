# 中心考试后端性能优化与隔离对照

日期：2026-11-09。

范围：`feat/public-photo-web`的本地工作区，保留前轮UI修改；未提交、推送或部署。Node24.19.0、PostgreSQL17.11-alpine3.23，测试数据库容器2核/512MiB、连接池8，随机回环端口和内存盘。全部为合成账号、元数据和图片，没有付费模型或私有对象桶调用。

## 变更与边界

看板先分组计算模块/作答计数，保留一致快照和原统计口径；入场在原事务及锁内批量写入模块、题位、错题计划。认证仍每次检查当前身份，仅节流在线时间更新；WS合并归属与序号读取。图片增加反向/变体索引、当次授权后的有界字节复用和原图流式传输；上传等待三份并发保存全部完成再收尾。

原因、替代方案及限制归[决策](../../.agents/notes/implemented/architecture/2026-11-09-managed-backend-performance.md)。运行语义见[媒体](../subsystems/managed-exam-media.md)、[平台](../subsystems/managed-exams.md)和[看板](../subsystems/managed-exam-dashboard.md)，升级步骤见[指南](../cookbook/managed-exams.md#计时升级与回退)。迁移12只增加索引，旧迁移哈希不变；本轮未升级远程数据库。

## 性能证据

开工前证据在`.runtime/backend-perf-20261109/`；实现与复测证据在`.runtime/backend-optimization-20261109/`，包含基线清单/补丁、日志、旧统计函数源码快照和`after.json`。旧函数从HEAD提取，使用同一个隔离库及相同权限参数；投影去除生成时间与实时计时后完全一致。

正式对照在构建和单元检查完成后运行；每项预热一次，顺序取7轮，中位数及区间保留在JSON。学生已入场、每人98题，题位尚无真实模型答案。这是数据库函数及隔离存储控制测试，不能当作公网响应或持续并发容量。

| 检查 | 结果 |
| --- | --- |
| 120人统计函数，同数据同计时范围 | 旧493.66ms，新45.72ms；新旧均8条SQL，投影相同 |
| 120人原WS检查与现检查 | 原实现每2秒4条SQL；新实测2条，当前会话与权限仍逐次读取 |
| 单个98题入场 | 原222条SQL，新22条；分别首次单样本331.19ms/36.39ms，耗时仅作观察 |
| 35,280资产、11,760引用 | 原查询出现全表扫描；迁移12后使用图片引用和父图/变体索引，缩略图查询0.035ms、反向查询0.123ms，均为一次EXPLAIN观测 |
| 媒体复用/上传 | 重复预览复用字节，HEAD及撤权仍检查；任何上传失败须等全部PUT结束后标记失败家族 |

## 验证记录

- `pnpm --filter @solveflow/db build`及`pnpm --filter @solveflow/exam-web build`最终退出0；首次构建暴露Node与DOM流类型差异，改为最小读取接口且保留unknown字节检查。
- `pnpm exec vitest run --project unit apps/exam-web/src/server/media-reader.test.ts apps/exam-web/src/server/images.test.ts apps/exam-web/src/server/config.test.ts`：3文件15项，退出0。
- 隔离PG下`managed.integration.test.ts -t 'performance:'`首轮有4项复现性能问题，1项因分配夹具误用settings而拒绝；修正为真实mode/wrongCounts后5项通过。后续增加4800题失败回滚和认证撤权锁竞争，纳入完整回归。读图取消信号补充后另跑`-t 'performance: cancelling during solver image'`，1项通过、退出0，确认存储取消且模型派发0次。
- 完整集成入口：`node scripts/test-managed-exams.mjs --image=postgres:17.11-alpine3.23 --suite=all`，退出0，11组共237项通过；每组独立数据库、180秒上限，未放宽检查。
- 性能复测一次在PG初始化重启时误判Unix套接字就绪而失败，未进入业务测量；本地探针改为等待TCP就绪，重跑通过。失败与先前不同计时口径记录保留，不累计为额外样本。
- 文档首轮超限23单位，精简原图说明后继续检查，不改长度门槛。

`verification-counts.json`去重为253项：完整集成237、后补取消1、单元15。`pnpm lint`和`git diff --check`退出0；初轮文档另差4单位，继续精简后通过。11份旧迁移逐字节与HEAD相同，前轮UI源码哈希保持不变。

## 未验证项

未进行线上网络、真实COS/S3、真实模型答题及12人持续混合负载。模型输入、预算和付费重放策略未改；本轮不能证明数学题四五分钟或公网原图十秒延迟已经消失。回退应用保留新增索引，不反向删除业务数据。
