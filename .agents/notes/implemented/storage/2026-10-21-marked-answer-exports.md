# 作答副本可选错题标记

日期：2026-10-21。状态：implemented。范围：Web预览、打印、PDF/ZIP、后台任务；不改变对错规划或保存答案。

## 背景

原作答副本只显示总对错数。用户要求看到具体错题并保留原版。[副本计划](../../../../packages/client/src/batch-print-variants.ts)已有每题incorrect字段，标记应消费同一已接受计划，不能另行选题或重新判题。

## 决定

“题目与作答”增加默认关闭的“标记错题”。[投影](../../../../apps/mobile/src/dom/batch-copy-document.tsx)仅在显式开启且该题incorrect为true时显示“× 作答错误”并突出作答区；题号标记随[续页](2026-10-21-question-continuation-pages.md)重复。正确题不添加校验通过声明，纯题/原始记录不读取标记。

[契约](../../../../packages/contracts/src/export-task.ts)在v1中新增可选boolean markIncorrect，仅作答模式允许true。缺字段旧记录保持不标记，读取不回写，不迁移历史；不承诺旧客户端降级读取新字段。[队列](../../../../apps/mobile/src/local/web-export-tasks.ts)接受时连同计划和图示冻结；[执行](../../../../apps/mobile/src/local/run-batch-export.web.tsx)不读取后续弹窗状态，保存重试及下载复用原成品。PDF/ZIP名增加“标记错题”后缀，原格式与字节限制保持，记录列表区分版本。

## 放弃的方案

默认替换违背保留原版的要求；仅标预览会让打印/后台不一致。新增内容模式会重复作答准备和规划逻辑，故使用独立显示选项。重新调用Agent判错既增加费用，也脱离已接受计划，本轮未采用。

## 后果与限制

标记代表本份对错计划，包括原标红及按设置新增的错误，不构成独立核验或正确答案保证。错误题号标记每页保留，作答仍只出现原有一份。原始答案和模型权限保持。

## 验证

[契约](../../../../packages/contracts/src/export-task.test.ts)覆盖旧v1及非法组合；[队列](../../../../apps/mobile/src/local/web-export-admission.test.ts)验证接受后改选项不改变任务。[浏览器](../../../../tests/mobile-e2e/background-exports.spec.ts)检查PDF像素、打印、后台和重载；实际成绩见[验收](../../../../docs/postmortem/2026-10-21-marked-pdf-and-export-ui.md)。

2026-10-22：填写备注时的文件命名由[副本备注决定](2026-10-22-export-copy-remarks.md)局部替代；留空旧名、标记呈现及任务字段继续有效。
