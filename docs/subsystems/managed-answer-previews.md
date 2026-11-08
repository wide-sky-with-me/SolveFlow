# 当前答案高亮与总览预览

学生当前答案与教师“学生当前答案”共用[答案摘要](../../apps/exam-web/src/browser/answer-summary.tsx)，适用中心考试学生页的[当前答案](../../apps/exam-web/src/browser/student-answer.tsx)与[本节总览](../../apps/exam-web/src/browser/section-answers.tsx)。当前题导航、任务状态和切题规则归[逐题流程](managed-student-flow.md)。

## 选择题与填空题

选择题在高亮字母旁展示实际所选选项内容，两行省略，完整内容保留在详情中。选项按当前材料、run与人工版本匹配，不从解释猜标签；当前题详情按需预读，与展开详情共用请求，轮询不重复加载。

数值、分数和文字填空优先采用已发布结果的结构化`responseValue`，单独突出显示，解释仍在下方。只有AI核验通过才用浅绿，其余浅黄；人工确认单独标识，不冒充AI通过。纯答案与高亮完全相同时不重复显示一遍正文。教师仅在题位、材料、run与人工版本一致时采用快照中的短值，防止人工修改后混入旧AI答案。

总览同样直接显示这个短答案；长文字省略，明确标注的公式沿共用KaTeX显示，完整答案仍可点题查看。当前题的蓝色高亮、五类状态和红色问题不改变；活动重答、核验中或出错时仍沿原规则隐藏可能过时的预览。

## 旧答案与安全回退

[摘要辅助](../../apps/exam-web/src/browser/answer-value.ts)兼容旧文本中明确的“结果／答案／Result／Answer”行，最终结论优先；也接受全文已经是短数值、简短名词或独立公式的答案。不从推导中的数字猜最终结论，冲突或无法可靠提取时，总览显示“查看答案”，答题页保留全文。

[短答案渲染](../../apps/exam-web/src/browser/answer-value-text.tsx)只有明确的数学片段进入共用富文本；普通文字直接显示，不在导航按钮里生成链接、图片或其他交互控件。公式仍禁用可信命令。

## 数据与兼容

[考试快照](../../packages/db/src/exam-attempts.ts)在同一个一致读取事务里，从当前发布presentation指向的run读取短值，要求材料版本一致。老师人工修改后只采用人工正文，不继承旧AI数值；模拟展示也不透传原始值。原始结果和展示记录均不改写，无新增迁移或模型调用。

浏览器通过[共享契约](../../packages/contracts/src/managed-exam.ts)定义的能力请求头显式申请；不带头的旧客户端仍收到原字段集。普通题不逐个请求详情来拼总览，整个考试的短值用一次有界查询读取。设计原因与限制见[决策](../../.agents/notes/implemented/rendering/2026-11-07-non-choice-answer-values.md)，本地证据见[验收](../postmortem/2026-11-07-non-choice-answer-values.md)。
