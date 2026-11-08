# 解算图片预算与答题诊断

日期：2026-11-07。状态：implemented。范围：中心考试答题解算期的模型输入图片预算、解算诊断日志，以及"先发答案后补校验"的评估结论。

## 背景

腾讯云 11-07 当日 622 次解题实测：整体 p50 约 13 秒、平均 19 秒，长尾来自三处——上传图片体积、模型输出不合格触发的整轮重试，以及上游约 60 秒的挂起。单次 solver 调用实际携带三张图（主图 2048px/q92 与两张 0.65 宽裁剪、q96），密集页面合计约 2.2 MB；实测这类请求首字 2.1 秒、整轮 10–28 秒。测量与对照数据在忽略目录 `.runtime/speed-2026-11-07/`。

## 决定

[模型输入图](../../../../apps/exam-web/src/server/images.ts)新增 `solverImage`：解算与裁剪视图统一收敛到长边 1600、JPEG q85，学生端"清晰预览"仍用原来的 2048px/q92 副本，权限与存储不变。`prepareActViews` 的裁剪视图同样使用该预算，避免主图缩小而视图仍按 q96 出图。

[解算诊断](../../../../apps/exam-web/src/server/worker.ts)把 `onDiagnostic` 接入 worker 的 `console.warn` 结构化日志；此前该参数为 `undefined`，`model_call_attempts.error_code` 又只在终态写入，导致 57 次失败无法区分超时与上游报错。

[模型输出解析](../../../../packages/agent/src/pi/mobile.ts)在既有围栏/花括号/转义/尾逗号修复之前，先归一化 BOM、不换行空格与零宽字符。

## 放弃的方案

**先发答案后补校验**最初尝试在校验前直接写 `answer_presentations`，被 `run_results` 的外键与 `IMMUTABLE_EXAM_RECORD` 触发器挡住而回退；最终改为独立的增量 draft 表，详见[校验期先发答案](2026-11-07-early-answer-publish.md)，其中包含校验一致静默、答案修正才通知的判据。

未把学生上传侧压缩作为主手段：服务端已把模型副本规范化为 2048px/q92，客户端压缩只影响上传耗时，不影响模型预填充。

## 后果与限制

实测同一批真实题图（4 道题，各 1–8 次配对）：字节 2.23 MB → 0.81 MB（−64%），首字中位 2056 ms → 1636 ms（−420 ms），整轮中位 −1.8 秒；4 道题的最终答案（B、A、y=51、k=75）与改动前完全一致。样本量小、且只覆盖当日所用 SAT 数学与阅读题，不能据此宣称所有图表题、公式密集题的识别准确率不变。

## 验证

[图片预算单元](../../../../apps/exam-web/src/server/images.test.ts)与 `pnpm exec vitest run apps/exam-web/src/server/images.test.ts packages/agent/src/pi/mobile.test.ts` 通过（2 + 63 项，合成噪声图与新解析用例）；`node scripts/test-managed-exams.mjs` 的 core 79、practice 5、models 10、boundaries 16 项分别通过；`pnpm --filter @solveflow/exam-web typecheck` 退出 0。真实模型调用仅用于本地测速，未改动任何已部署服务。
