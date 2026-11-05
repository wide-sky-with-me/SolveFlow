# 中心考试六项功能与界面修复

日期：2026-11-05。范围：`feat/public-photo-web`本地工作区；承接[功能与界面审查](2026-11-05-functional-ui-review.md)。不提交、推送或部署，不修改腾讯云、远程Mac及既有用户数据。本轮只用隔离数据库、合成图片和假结果，未调用付费模型。

## 修复内容

| 原问题 | 本地处理 |
| --- | --- |
| 补图已提交但回执丢失，删图后重试出现409 | 新增本人题位的只读回执；发送后冻结图片和请求标识，不确定时先查询。只有主动点击才同键同内容重试，不自动派发收费任务 |
| 手机时钟偏差禁用合法考试 | 新版分页显式请求服务端入场状态；旧接口省略新字段，兼容已有严格解码器 |
| 撤回考试仍保留开始弹窗 | 弹窗按安排ID读取最新available记录，失效后关闭 |
| 自由拍题没有统一图片操作 | 复用考试图片查看器，支持放大、拖动、适应窗口和全屏；本地Blob仍由原页面释放 |
| 进度表操作列被裁切，手机先看多个图表 | 调整桌面列宽和状态排列；窄屏改为带标签的卡片，手机把学生进度移到摘要之后 |
| 同一错误同时出现在正文和草稿 | 错误归当前操作弹窗，未知保存结果使用明确的同步入口，不再向学生展示幂等术语 |

提交恢复规则归[子系统](../subsystems/managed-exam-submissions.md)，入场兼容归[列表](../subsystems/managed-exam-lists.md)，布局归[看板](../subsystems/managed-exam-dashboard.md)，接口及并发取舍归[决策](../../.agents/notes/implemented/architecture/2026-11-05-exam-client-recovery.md)。没有新增依赖或数据库迁移。

## 验证记录

- `pnpm exec vitest run --project unit apps/exam-web/src/browser/api.test.ts packages/contracts/src/managed-exam.test.ts --maxWorkers=2`：退出0，18项通过，含8秒回执读取期限、页面取消、旧字段兼容和严格回执。
- `pnpm --filter @solveflow/exam-web build`：最终退出0，类型检查及浏览器/服务构建通过，见`build-delivery.log`。
- 定向隔离回归先17项通过，覆盖Chrome/WebKit时钟、撤回、图片查看、提交未到达、已接收但回执丢失、回执暂不可读、真实连接重置及回执归属。
- `node scripts/test-managed-exams.mjs --image=postgres:17.11-alpine3.23`在`full-3.log`确认core44、core-ui59、boundaries16、practice5项通过；timing16项通过、2项失败后停止，allocations未执行，退出1。
- 修复后运行`node .runtime/workflow-repairs/final-followup.mjs --image=postgres:17.11-alpine3.23`，沿原隔离启动、筛选和每组180秒期限复测：core-ui59、timing18、allocations8项全部通过，退出0，见`final-followup.log`。与前述未受后续表格修改影响的core44、boundaries16、practice5合计150个不同用例，各组均已通过；重复复测不另累计。
- `pnpm lint`：源码边界及文档检查通过，退出0；没有提高超时、像素容差或文档长度上限。

隔离测试使用随机PostgreSQL17.11-alpine3.23容器、回环HTTP和Chrome/WebKit。证据在忽略目录`.runtime/workflow-repairs/`。界面覆盖320至1920宽的11个断点、双主题、双浏览器，共44张首页截图；操作可见、不横溢出、手机学生进度位置和题号可见性均通过。人工抽查桌面、平板、手机、恢复草稿、图片查看及教师结束考试详情；不等于逐像素检查全部页面。最终构建和复测后未再修改产品代码。

首次完整运行`full.log`在core组42项通过、两项既有浏览器流程超时。在线人数用例依赖其他测试在45秒内留下的会话，现改为独立场次并创建其三名在线学生，仍断言3人在线；两项隔离复测均通过，原30秒/20秒时限未修改。其他诊断日志保留，不以反复重跑增加样本数，也不把夹具修正当作线上网络问题已解决。

`full-2.log`的core组44项通过，core-ui组55项通过、两项表格对齐失败：新列宽与首页16px内边距冲突，内容超出可用宽度而偏移。调整数字列宽和样式优先级，保持原1.5px断言；新加回执读取4xx回归先在两种浏览器失败，再区分“提交拒绝”和“查询失败”，维持冻结且不自动连查。`edges-green.log`这四项复测退出0；未更改原超时或断言。

`full-3.log`又发现实时跟踪分页的560px表格下限覆盖卡片宽度，教师详情开着时也让背景整页横溢出。提高窄屏卡片规则优先级，原计时组两项在`timing-overflow-green.log`复测通过；保留失败截图及元素宽度。窄桌面的模块名省略时另行保留题号。没有放宽不溢出或对齐断言。

## 未验与范围外

不代表iPhone真机、腾讯云公网、真实模型、相机清晰度或负载已通过。指定具体错题号、目标分数换算、自定义角色权限不属于本轮六项修复；域名网络限制及公网慢读原因仍沿用原审查结论。未重写历史验收，也未以旧成绩证明新版能力。
