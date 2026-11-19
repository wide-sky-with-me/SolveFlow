# 已结束考试通知消隐、角色权限维护与卡片式实时跟踪

日期：2026-11-19。状态：implemented。范围：中心考试待处理通知生命周期、角色权限管理及实时跟踪视图。

## 背景

线上多场实考结束后，历史场次遗留的未解决核验记录仍持续触发教师右下角全局提醒、默认待处理队列、看板问题计数及学生端“其他考试仍有题目待处理”横幅，干扰后续新场次。同时，「角色权限」页仅有四行简短静态表格，缺少越权边界说明且无法直接在角色维度维护职责备注或批量调整成员；「实时跟踪」沿用看板摘要的扁平表格，多场次与多学生并行时缺少按场次和按学生的分层卡片视图。

## 决定

- **已结束场次自动消去活动待处理提醒**：[列表投影](../../../../packages/db/src/exam-list-sql.ts)统一定义未结束作答条件 `ongoingAttemptSql`（未主动结束、未过截止时刻、场次发布且未归档撤回）。[待处理队列](../../../../packages/db/src/exam-attention.ts)、[看板统计](../../../../packages/db/src/exam-dashboard.ts)、[分页列表](../../../../packages/db/src/exam-lists.ts)的 `attentionTotal` 与 [学生作答页](../../../../apps/exam-web/src/browser/student.tsx)顶栏提醒仅对进行中考试生效；底层 `verification_incidents` 记录完整保留，教师可在[待处理题页](../../../../apps/exam-web/src/browser/issue-queue.tsx)显式切换“含已结束考试”或进入单场详情做考后复核。规则见[问题与通知](../../../../docs/subsystems/managed-exam-attention.md)。
- **内置四角色权限矩阵与成员/备注维护**：新增增量迁移 [0013](../../../../packages/db/migrations/0013_role_descriptions.sql) 为 `exam_app.roles` 补充 `summary`、`note` 与 `updated_at`；[角色事务](../../../../packages/db/src/exam-roles.ts)与[角色界面](../../../../apps/exam-web/src/browser/role-permissions.tsx)展示四类内置角色的数据范围、可执行操作与越权禁区，支持系统管理员编辑显示名/概述/职责备注及批量授予或移除角色成员。角色变更沿用账号级互斥锁，禁止移除当前管理员自身 `admin` 角色或清空用户唯一角色，并同步递增 `auth_version` 使旧会话权限立即失效。
- **按场次/学生双视角卡片式实时跟踪**：[考试契约](../../../../packages/contracts/src/managed-exam.ts)与进度投影补充 `studentId`、`studentUsername`、`sittingId`、`eventTitle`、`exam` 与 `entryState`；[卡片跟踪面板](../../../../apps/exam-web/src/browser/tracking-cards.tsx)默认按场次分组（展示场次在线/答题/待处理汇总及组内学生实时卡片），并支持一键切换按学生分组视角，保留组合筛选、分页与详情弹窗联动。规则见[列表与分页](../../../../docs/subsystems/managed-exam-lists.md)。

## 放弃的方案

- 在考试结束时直接把数据库中的 `verification_incidents` 标为已解决会抹除真实核验历史并触发虚假的“已解决”通知，因此保留底层记录、仅在活跃提醒与默认统计查询中按作答未结束过滤。
- 引入自定义角色与逐接口动态 RBAC 权限开关需改写全库行级归属 SQL 并增加误配越权风险，保留四级内置安全边界而开放职责说明与角色成员批量管理。

## 后果与限制

学生交卷、老师结束或定时截止后，双端待处理提醒在当次同步即消去；考后如需集中排查历史遗留问题，须在「待处理题」筛选中切至“含已结束考试”。实时跟踪分组作用于当前分页数据，跨页总量与在线去重人数仍由服务端按完整授权范围返回。上线前须先执行 `0013` 数据库增量迁移。

## 验证

隔离 PostgreSQL 与 Chrome/WebKit 集成测试覆盖：考试结束前后教师浮窗/默认队列/看板/学生提醒的即时消隐与 `includeEnded=1` 考后查询；角色说明编辑、批量授权/撤权、`auth_version` 递增及自锁/单角色保护；实时跟踪按场次与按学生分组切换、卡片打开详情及 `1440/390/320px` 浅深双主题零溢出校验；`pnpm lint` 通过。
