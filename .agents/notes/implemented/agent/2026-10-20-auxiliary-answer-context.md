# 辅助请求的题干与对话绑定源答案版本

日期：2026-10-20。状态：implemented。范围：设备请求准备、共享学习上下文及保留服务历史封包。

## 背景

ACT 功能核查复现：R1 为 ACT 原答案，R2 更正题干/考试或选项。对 R1 请求核验、步骤或知识点时，[请求准备](../../../../packages/client/src/local-run-request.ts)采用 R1 的图片与候选，但此前学习上下文从整个同题线程寻找最后一次更正，对话历史也含 R2。新题干与旧图混用，违反[材料快照决定](2026-10-04-exam-response-and-materials.md)仍有效的源版本语义。

## 决定

[answerContextHistory](../../../../packages/client/src/learning-history.ts)先保持现有题号/线程投影，再仅对 explanation、knowledge-list、verification 按源作答版本的保存顺序限定历史、更正与完整上下文。若源本身是较晚生成的辅助结果，沿其显式 sourceRunId 继续找到作答版本，同时保留引用所需的辅助祖先；沿用有界/无环的已保存引用校验。

不以 createdAt 截断，设备墙钟可能回退。普通追问、更正和显式重做继续使用当前题图与最新有效更正，不因本次修复冻结新对话。[设备调用方](../../../../packages/client/src/local-run-request.ts)和[保留 worker](../../../../apps/api/src/worker.ts)共用历史选择；不新增持久字段、迁移或模型权限，不删除/重写旧答案。

## 放弃的方案

只过滤 problemCorrection 仍会从 history 传入未来更正；只截到较晚辅助 run 的位置会重新引入其间更正，均由回归覆盖。过滤所有新对话会丢失用户明确补充，故只限制三类按需请求。按整条显式祖先链删除全部较早历史会改变既有普通对话语义，本轮保留源作答发生时已有的同题历史。

## 后果与限制

上下文结构合法不保证识图、答案或独立核验正确。保留服务不因此获得设备补图管理或新的考试预加载能力。超过原引用深度或无效引用仍失败，不放宽路径/身份校验。

## 验证

[ACT源版本回归](../../../../packages/client/src/local-image-edit.test.ts)覆盖三类辅助、后续更正、墙钟回退与嵌套辅助；[多题投影](../../../../packages/client/src/exam-context.test.ts)核对题号分支，[服务封包](../../../../apps/api/src/history.test.ts)核对共享边界，[ACT浏览器行为](../../../../tests/mobile-e2e/act-flow.spec.ts)操作历史答案核验。失败复现、实际命令/成绩和未验范围统一见[本轮核查](../../../../docs/postmortem/2026-10-20-act-completeness.md)。
