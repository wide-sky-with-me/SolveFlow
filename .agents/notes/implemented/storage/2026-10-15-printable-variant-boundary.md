# 作答变体跟随打印选项边界

日期：2026-10-15。状态：implemented。范围：Web作答设置、打印与独立PDF任务。

## 背景

整理后的problem用于打印，副本计划却读取保存候选的选项及完整性。真实缓存存在optionsComplete=false，而原候选完整；合成UI已复现整理成功后仍能基于旧标记新增错误作答。源码还允许新选择不属于实际打印选项。

## 决定

[展示适配](../../../../apps/mobile/src/local/batch-print-presentation.web.ts)建立仅供规划的投影，不覆盖原候选、回答或持久题目：[共享契约](../../../../packages/contracts/src/batch-print-variants.ts)的可选printOptions/printOptionsComplete表达打印标签和完整性，未映射原选择禁用新增选择。界面参照和[规划器](../../../../packages/client/src/batch-print-variants.ts)消费同一元数据。字段不落题库、无持久化迁移；原候选自校验保持。未知完整性沿用旧状态，明确不完整不生成新错误选择；原作答仍可参考导出，未映射选择在作答页提示。

打印准备后再核对计划，独立渲染在最终内容准备后检查已改变的选择是否完整且可见。失败给具体题号，停止生成；不悄悄改已接受副本。继续保留[后台任务决定](2026-10-14-background-pdf-exports.md)的固定快照和计划边界，保存重试不重规划、不调用模型。

## 放弃的方案

不改原答案或用截断的打印选项直接替换原题：会丢失原选择归属，甚至把选择题变成填空题。不在队列接受后重规划：会改变用户已接受的副本内容。

## 后果与限制

版面变化时需重新核对与提交，已有文件再下载仍直接复用文件。边界不证明原题识别或答案数学正确性。

## 验证

[单测](../../../../apps/mobile/src/local/batch-print-presentation.test.ts)覆盖新可见标签、不完整选项、未映射原选择和渲染前计划变化；[交互回归](../../../../tests/mobile-e2e/paper-preparation.spec.ts)保留有效RED及基线下载断言。[独立渲染](../../../../apps/mobile/src/local/run-batch-export.web.tsx)、[打印与界面](../../../../apps/mobile/src/components/batch-pdf-export.web.tsx)使用相同边界。当前状态与实际命令成绩见[验收](../../../../docs/postmortem/2026-10-15-pdf-export-acceptance.md)。
