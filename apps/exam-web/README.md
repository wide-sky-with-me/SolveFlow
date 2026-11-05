# SolveFlow 中心考试平台

独立学生/管理入口，现有公网单题版继续由 `apps/photo-web` 运行。

当前包含：密码登录、固定角色/负责范围、考试模板与时间分配、模块题位、逐题拍摄、重拍补图、服务端历史、后台任务、实时通知、自由跳题/跳模块及当前位置跟踪、持续红色核验提醒和老师重答/核验/人工确认。考试目录与支持边界见[模板](../../docs/subsystems/exam-formats.md)。正常答题与错题模拟均保留实际解答，模拟展示另存。

- 构建：`pnpm build:exam-web`。
- 类型：`pnpm --filter @solveflow/exam-web typecheck`。
- 隔离验收：`pnpm test:exam-web --image=postgres:17.11-alpine`；须先准备对应本机Docker镜像和Chrome，不调用真实模型。
- 运行：设置 `SOLVEFLOW_EXAM_CONFIG` 指向私有JSON，再用 `pnpm start:exam-web`；默认回环3190。

操作步骤、迁移与容器限制见[指南](../../docs/cookbook/managed-exams.md)，状态边界见[当前语义](../../docs/subsystems/managed-exams.md)。AI按目标分数规划、完整数据生命周期、生产对象存储联调与恢复演练尚未完成，不能仅以本地假模型通过宣称生产可用。
