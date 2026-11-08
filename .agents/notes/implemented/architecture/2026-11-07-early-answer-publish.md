# 校验期先发答案

日期：2026-11-07。状态：implemented。范围：中心考试解算完成到核验结束之间的学生端答案可见性。

## 背景

服务端原本只在 `finishJob` 里写 `answer_presentations`，学生必须等 solver 与 verifier 两段串行结果。11-07 实测两段平均 11.6 秒与 5.8 秒，感知延迟约 19 秒。直接在校验前发布展示行的做法被外键与不变式挡住：`answer_presentations` 指向 `run_results`，而 `run_results` 带 `IMMUTABLE_EXAM_RECORD` 触发器，候选答案在校验前后无法作为同一行被修正。

## 决定

新增纯增量的[draft 表](../../../../packages/db/migrations/0009_exam_answer_drafts.sql)，只存槽位、学生、run 与候选答案；[publishDraft](../../../../packages/db/src/exam-jobs.ts)在 solver 产出合格候选后写入（幂等 upsert），[finishJob](../../../../packages/db/src/exam-jobs.ts) 与取消、失联回收路径删除它，`run_results`、`answer_presentations` 与既有不可变约束一律不动。

槽位快照[只对当前 run 且未结束的解答](../../../../packages/db/src/exam-attempts.ts)暴露 `draft`；学生卡片[按候选答案先渲染](../../../../apps/exam-web/src/browser/student-answer.tsx)并标注“校验中，最终结果可能调整”，核验完成后由正式 `presentation` 覆盖。文案不宣称草案已核验。

## 放弃的方案

新增可更新列或放宽 `run_results` 触发器会破坏“原始解答不可改写”，并牵连教师复核与导出读取同一份记录；把答案塞进既有 `changed` 事件只通知序号，不带数据，客户端仍要重新拉取，等于把同一份草案再写一次数据库。两条都比一张独立 draft 表更难回退。

## 后果与限制

草案不写入 `run_results`，因此学生刷新、换设备后仍能看到它（快照读取），但草案本身不参与复核、导出或教师视图；若进程在校验期间被杀，`recoverJobs` 删除它并把题位标为中断。当前只覆盖自动核验路径，教师人工复核仍走既有 `teacher_reviews`。

## 校验后不一致才通知

用户明确：校验结果一致则静默无通知；答案被修正才通知学生。草稿行在 finishJob 里先读出作为「学生已看到的初始答案」基准，与最终发布的 answer_presentations 比较 answer 和 selectedOptions；相同不写任何通知，不同才向 [answer_revisions](../../../../packages/db/migrations/0009_exam_answer_drafts.sql) 插入一条持久记录。通知随快照下发（[unreadAnswerRevisions](../../../../packages/db/src/exam-attention.ts)），学生[点开最新答案后](../../../../apps/exam-web/src/browser/student.tsx)才标记已读；重拍换版本或答案尚未发布时通知不显示。verified 从 false 变 true 只是状态位，不算答案更改。

放弃「内存 WS 草稿」：worker 与 api 是不同容器，草稿要跨进程且 worker 重启/断线不能丢；中心化架构下答案权威副本本就在 PG，落库与既有持久通知一致。

## 模拟题的发布边界

11-07分层回归发现，预设为错题模拟的题若先展示原始候选，会与最终模拟选项冲突并触发无意义的“答案修正”提醒。[publishDraft](../../../../packages/db/src/exam-jobs.ts)对冻结计划中的模拟题不发布草稿，等待既有最终展示事务；普通题保留提前展示。该限制不改原始模型结果或人工确认，回归见[场次与消息验收](../../../../docs/postmortem/2026-11-07-exam-history-messages-events.md)。

## 验证

集成用例 `shows a solver draft only while the run is unfinished` 断言：待核验时 `presentation` 为空而 `draft` 为候选答案，`finishJob` 后 `draft` 为空、`presentation` 为正式答案，且 `answer_drafts` 表清空；`node scripts/test-managed-exams.mjs` 的 core 79（含答案不一致才通知与一致静默两项）、boundaries 16、practice 5、models 10、timing 18 项通过，`pnpm --filter @solveflow/exam-web typecheck` 与 `pnpm lint` 退出 0。全量浏览器用例沿用既有隔离环境，本轮未重新采集真实公网截图。
