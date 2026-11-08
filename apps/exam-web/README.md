# SolveFlow 中心考试平台

独立运行的学生、教师和管理入口，复用共享契约、数据库事务与Web组件。公网单题版由`apps/photo-web`运行，设备客户端仍走自己的本地存储与模型链路，三者边界见[架构](../../docs/architecture.md)。

## 开发入口

- 构建：`pnpm build:exam-web`。
- 类型：`pnpm --filter @solveflow/exam-web typecheck`。
- 隔离验收：`pnpm test:exam-web --image=postgres:17.11-alpine3.23`；须先准备对应本机Docker镜像和Chrome，不调用真实模型。分组选择归[测试脚本](../../scripts/test-managed-exams.mjs)。
- 运行：设置 `SOLVEFLOW_EXAM_CONFIG` 指向私有JSON，再用 `pnpm start:exam-web`；默认回环3190。

## 代码定位

| 职责 | 入口 |
| --- | --- |
| 登录、身份与顶栏 | [main.tsx](src/browser/main.tsx) |
| 场次与具体考试列表 | [exam-events.tsx](src/browser/exam-events.tsx) |
| 两级编辑与成员查询 | [编辑表单](src/browser/exam-event-editors.tsx)、[成员弹窗](src/browser/exam-event-members.tsx) |
| 学生记录、入场与逐题工作区 | [student-workspace.tsx](src/browser/student-workspace.tsx)、[student.tsx](src/browser/student.tsx) |
| 教师查看、介入与待处理队列 | [monitor.tsx](src/browser/monitor.tsx)、[issue-queue.tsx](src/browser/issue-queue.tsx) |
| 统一看板与发布明细 | [dashboard.tsx](src/browser/dashboard.tsx)、[dashboard-publications.tsx](src/browser/dashboard-publications.tsx) |
| 答案值与两端共用摘要 | [answer-value.ts](src/browser/answer-value.ts)、[answer-summary.tsx](src/browser/answer-summary.tsx) |
| 页面布局、主题与动效 | 各功能CSS、最后加载的[design.css](src/browser/design.css)及[共用组件](../../packages/web-ui/README.md) |
| HTTP、异步解题与数据库事务 | [service.ts](src/server/service.ts)、[worker.ts](src/server/worker.ts)、[数据库包](../../packages/db/AGENTS.md) |

## 文档归属

[平台语义](../../docs/subsystems/managed-exams.md)维护运行边界和功能导航；[操作指南](../../docs/cookbook/managed-exams.md)维护启动、使用与迁移步骤；[发布状态](../../docs/project-status.md#中心考试分支)区分本地改动、远程发布和待验收项。当前功能和生产限制沿这些页面维护，不在README重复列实现清单或历史测试成绩。
