# 持久核验问题与老师处理

日期：2026-11-03。状态：implemented。范围：中心考试题位、提醒、人工处理和考试模板；不涉及旧设备端或真实评分保证。

## 背景

[第一阶段](2026-11-02-managed-exam-foundation.md)可保存未核验答案并继续下一题，但灰色标记不足以形成可追踪问题。用户要求红色提醒累计、刷新不消失，并明确允许有效AI PASS或老师填写答案和处理意见解除。老师操作不能覆盖学生刚补的新图。

## 决定

新增[0004迁移](../../../../packages/db/migrations/0004_exam_reviews.sql)，一题一个开放incident，保留已解决记录；旧失败/未核验当前题回填。原始run_results及题图版本不变。人工处理另存不可UPDATE的teacher_reviews，展示标记humanConfirmed且verified=false；核验统计与人工确认分开。

[老师事务](../../../../packages/db/src/exam-reviews.ts)检查当前负责范围、材料版本、run及幂等键；确认可以取消本题活动run，不改变其他题。写入、问题解除、游标与事件同事务提交。[状态辅助](../../../../packages/db/src/exam-review-state.ts)统一推进与问题建立。未拍题不能跳过；已拍但失败可显式暂留并继续，保留红色且不计已出答案。

[任务](../../../../packages/db/src/exam-jobs.ts)的teacher verify引用同版本原始候选；[worker](../../../../apps/exam-web/src/server/worker.ts)复用现有verificationTarget，不能把老师判断伪装为AI PASS。老师在考试截止后主动请求有独立7分钟收尾窗口，每次外发仍检查当前身份/负责关系、撤销和额度。学生截止不放宽，重连不重放收费。

[学生界面](../../../../apps/exam-web/src/browser/student.tsx)和[老师弹窗](../../../../apps/exam-web/src/browser/monitor.tsx)共用持久提醒；考试记录及管理首页也显示未处理数。重试、换图、取消不关闭提醒，迟到结果受版本/run/租约限制。

[考试目录](../../../../packages/contracts/src/exam-catalog.ts)保存官方版本和来源；[契约](../../../../packages/contracts/src/managed-exam.ts)兼容旧模块缺失字段的默认值。新模板保存学科、题型、词数等；返回结构不符保留原结果并转红色。AP按课程/年份，ESAT按报考科目，不猜统一题数。官方目录是结构来源，不是题库/计分换算。

## 放弃的方案

- 仅用前端通知或当前run状态：刷新会丢，重试会暂时掩盖问题。
- 老师直接改AI结果或verified：破坏来源与独立核验的含义。
- 旧版本核验完成就解除：可能清掉新补图的真实问题。
- 所有考试使用统一单选题位或通用AP题数：丢失填答、作文及多小问结构，忽略2027规则变化。

导航范围后来由[自由导航](2026-11-03-exam-navigation-and-tracking.md)局部替代：允许未拍跳题及跳模块；本页核验问题、身份和原始结果规则继续有效。

过期收尾、结果保存、登录及浏览器恢复边界由[审查修正](2026-11-03-exam-review-hardening.md)补充；本页其余导航/核验规则继续有效。

问题解除后的学生通知及按题分页入口由[解决通知](2026-11-03-exam-resolution-notifications.md)补充；本页问题建立和人工确认约束继续有效。

## 后果与限制

新增迁移必须先于服务启动。考试时长仍为参考，不模拟官方自适应或保证目标分数。AP内置12门2027课程，其余显式自定义；口语/作品集不在拍图链路。生产桶、真实模型质量、完整容器和恢复验收保持待办。实际行为见[子系统](../../../../docs/subsystems/managed-exams.md)，证据见[报告](../../../../docs/postmortem/2026-11-03-exam-reviews.md)。

## 验证

[隔离集成](../../../../apps/exam-web/src/server/managed.integration.test.ts)涵盖问题累积、版本冲突、身份撤销、人工确认、不同题型与实际Chrome同步；命令、初次失败与复测归报告，不用假模型证明真实识别准确率。

全部已拍题的教师操作及人工记录并发令牌由[后续决策](2026-11-03-teacher-question-actions.md)补充；教师必须有开放问题的限制已被替代，其余核验、归属与取消约束仍有效。
