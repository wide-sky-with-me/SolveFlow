# SAT / ACT / AP 模拟拍照评测 — 2026-09-28

状态：全部完成，918/918 道主测试已结束。本次输入全部是程序制作的模拟拍照图片，**没有手机实拍或手机端验收**。此前用户改为要求完全自动化测试；沿用已授权的付费范围。

## 结论与成绩

沿用 qwen3.8-flash 和当前生产解题核心。每道有效题图只取首次完整运行的结果；HTTP 错误、输出不合法和超时均按未作答计零分，不用后续对照替换成绩。模型自己的校验结果不参与判卷。

| 试卷 | 实际完成 | 成绩 | 备注 |
| --- | ---: | --- | --- |
| sat-8 | 120/120 | 1540–1580 | 阅读写作 63/66；数学 54/54 |
| sat-9 | 120/120 | 1520–1580 | 阅读写作 63/66；数学 53/54 |
| sat-10 | 120/120 | 1570–1600 | 阅读写作 65/66；数学 54/54 |
| act-1 | 171/171 | 35/36 | E/M/R/S = 33 / 36 / 36 / 33 |
| act-2 | 171/171 | 35/36 | E/M/R/S = 32 / 36 / 36 / 36 |
| act-3 | 171/171 | 34/36 | E/M/R/S = 32 / 36 / 35 / 34 |
| ap-calculus-ab-2024 | 6/6 | 44/54 | FRQ 内容估分 |
| ap-calculus-ab-2025 | 6/6 | 45/54 | FRQ 内容估分 |
| ap-calculus-ab-2026 | 6/6 | 36/54 | FRQ 内容估分 |
| ap-statistics-2024 | 6/6 | 19–20/24 | FRQ 内容估分 |
| ap-statistics-2025 | 6/6 | 23/24 | FRQ 内容估分 |
| ap-statistics-2026 | 6/6 | 23/24 | FRQ 内容估分 |
| ap-english-language-2024 | 3/3 | 10–13/18 | FRQ 内容估分 |
| ap-english-language-2025 | 3/3 | 6–8/18 | FRQ 内容估分 |
| ap-english-language-2026 | 3/3 | 8–10/18 | FRQ 内容估分 |

SAT 使用官方非自适应纸卷换算区间，不能等同 Bluebook 自适应精确分数。三卷数学合计 161/162，唯一失分是整次超时；阅读写作 191/198。存在 1550+ 的表现，但不能据此保证稳定 1550+。

ACT 采用这三套 enhanced ACT 练习册自己的答案、试测题标记和换算表。每套实际做 171 题，正式计分 E/M/R/S 分别为 40/41/27/34 题；综合分取 English、Math、Reading 三科均值并四舍五入，Science 单列，不包含 Writing。

AP 使用 2024、2025、2026 三年的公开 FRQ：微积分 AB 与统计每年各 6 题，英语语言每年 3 题。没有选择题部分，**不能换算成 AP 1–5 总分，也不是九套完整 AP 考试**。统计展示六题原始 0–4 分之和；未做完整考试权重换算。此范围也不代表 2027 改版统计考试。中文数学/统计回答按内容核对，未验证英文考场答卷要求。

AP 分数由 Codex 逐项依据官方评分细则核对，不是认证 AP 阅卷。数学精确值、可接受等价形式和各小问得分有记录；作文按 thesis / evidence-commentary / sophistication 分项评估，区间体现阅卷判断不确定性。不以字数短直接扣分，而以证据、解释、事实准确性与评分要求是否达成计分。

## 错误与失败的区别

| 范围 | 正确/得分情况 | 解题失败 | 答错却校验通过 | 已完成但校验超时 |
| --- | --- | ---: | ---: | ---: |
| SAT | 352/360 道 | 1 | 3 | 54 |
| ACT | 490/513 道 | 16 | 2 | 166 |
| AP | 见 FRQ 表；不混算正确率 | 7 | 不使用二元正确率 | 35 |

失败代码：`RUN_TIMEOUT` 9；`MODEL_UNAVAILABLE` 4；`MODEL_OUTPUT_INVALID` 3；`MODEL_LIMIT` 8。HTTP 400 的原始服务错误正文未保存，不能仅凭客户端 `MODEL_UNAVAILABLE` 文案认定模型下线。

确认的主要问题：

1. **英语分句边界、转折词归属及篇章推理。** SAT 8 的 M1 Q24、M2 Q26，SAT 10 的 M2 Q19 在清晰图下仍错；ACT 1 English Q10、Q34 也重复出错。题干文字能读出，不能都归因于模糊。
2. **同模型核验不是可靠的真值。** SAT 8 M1 Q24、M2 Q5 和 SAT 9 M2 Q16 首次答错却校验通过；SAT 8 M1 Q24 清晰图复测仍错、仍通过。
3. **图像细节识别。** ACT 1 Science Q6 把指向冰山的箭头读成冰架下方；AP Statistics 2026 Q6 把组别及相关强弱读反。ACT 3 English Q34 转写漏掉划线替换范围末尾的破折号，进而按错误边界判断语法。原图能保留文字不等于模型正确理解图表与标注。
4. **预算与结构化输出。** 有请求返回 HTTP 400、达到工具/模型调用上限，或最终 JSON/字段校验失败。AP Statistics 2024 Q2 的最终失败是 `MODEL_OUTPUT_INVALID`，诊断指向 `answer` 字段，不能描述成数学算错或单纯超时。
5. **AP 长答案不适合当前 brief 路径。** `BriefSolverCandidateSchema.answer` 上限为 1000 字符（`packages/contracts/src/agent.ts`），本次输入明确要求作文但仍走生产默认 brief。证据展开不足，部分回答还混淆事实。单纯增大 max output 不会解除这个字段限制。

校验阶段最多 20 秒，并共享 120 秒总预算（`packages/agent/src/pi/mobile.ts`）。SAT 9 Math M2 Q26 及部分 AP 失败的最后阶段已进入 verifier，但耗尽总预算后仍按失败结束；这是当前 `packages/agent/src/orchestration/solve.ts` 的明确行为。本次没有修改其安全边界，也不从中间未发布结果补分。

建议下一步分别验证：英语按完整分句/上下文核验；图表、下划线边界与长文章保留局部高分辨率证据；AP 使用适合长答案的契约而不是一味增大 token 上限；为校验明确预留时间并改善服务/格式错误诊断。先保持本次冻结基线，再另做前后对照，避免一边改提示词一边换算成绩。

## 清晰图对照

固定抽样：SAT/ACT 每套每个科目或模块的第 10、20 题，AP 每套第 1 题，共 57 道。错题诊断另列，是观察到错误后选取，不能当随机样本。每张图每种条件仅测一次，结果含模型随机性、服务时延差异；不能把所有改善都归因于去模糊。

| 范围/抽样 | 已配对题数 | 模拟图 | 清晰图 |
| --- | ---: | ---: | ---: |
| SAT / 固定 | 24/24 | 24 正确 | 24 正确 |
| SAT / 诊断 | 8/8 | 0 正确 | 5 正确 |
| ACT / 固定 | 24/24 | 23 正确 | 23 正确 |
| ACT / 诊断 | 22/22 | 0 正确 | 20 正确 |
| AP / 固定 | 9/9 | 43 FRQ 分 | 26 FRQ 分 |
| AP / 诊断 | 2/2 | 6 FRQ 分 | 3 FRQ 分 |

共 88 道唯一清晰图对照。AP Statistics 2025 Q1 同时属于固定和诊断组，只实际调用一次，不重复计算付费请求。AP 清晰图也出现超时，说明清晰度不能解决全部可靠性问题。

## 输入与运行方法

- 官方 PDF 原始像素渲染，保留原文、下划线、图表和选项；未用生成模型改写题目。先按题提取必要上下文，再做透视、空间亮度梯度、轻微模糊及 JPEG 压缩。
- 每三题一题采用中度扰动，其余轻度；按题号稳定 seed。轻度透视幅度参数 0.018、模糊 0.3 px、JPEG 88；中度 0.045、0.6 px、JPEG 78。清晰对照 JPEG 92；最长边 2048 px、无 EXIF。具体四角坐标、来源页与裁切框、哈希均在 manifest。
- 这是可重复的照片外观扰动，不是经过标定的手机光学仿真；未覆盖真实失焦、手抖、反光、摩尔纹、镜头畸变、相机/裁切 UI 或后台生命周期。
- ACT 多页文章/资料拼接后作答；AP 特别是八页左右的 synthesis 资料被拼为一图后缩至 2048，属于高密度长材料压力测试，不能代表一张普通手机照片。
- 每题独立会话，生产 `solveOnDevice` + Pi loop，`verificationMode=automatic`、`answerMode=brief`，最多一次修正。评分答案/细则不进入模型输入。调用的是主机 Node 解题核心，不是手机 UI 或相机吞吐测试。
- 配置固定：DMX `qwen3.8-flash`、Chat Completions、服务默认思考、context 1,000,000、max_tokens 16,384，同模型 verifier；无自动换模型。响应中报告的模型名也已核对。
- 调度早期每组 3 并发，后期 SAT/ACT 主测各 6，清晰图对照 3；单个调用仍使用原生产预算。时间是该并发负载下的主机端端到端耗时，不能视作手机速度。

程序制作题面发现跨栏、跨页缺失后，修正并重新运行；没有丢弃真实有效图上的错答。5 条输入不完整的旧结果，以及调整评测队列造成的 9 条取消结果保留在排除目录，调用用量也单独统计。SAT 10 Math M1 Q4 原图缺失跨页选项时模型正确请求补图，补全后才进入主测试。全量 SAT/ACT 选项标签审查、异常页视觉复查及 918 对文件完整性审查已完成。

公开练习题可能存在训练集污染，本次无法排除；同一批公开题的高分不能直接证明新卷泛化能力。模拟强弱按题号分组，不是同题随机对照，因此不把两组准确率差异解释成模糊的因果效应。

## 耗时与已报告用量

| 范围 | 单题中位耗时 | P90 |
| --- | ---: | ---: |
| SAT | 21.4 秒 | 44.6 秒 |
| ACT | 31.4 秒 | 61.6 秒 |
| AP | 69.2 秒 | 120.0 秒 |

| 请求组 | 记录数 | HTTP 请求数 | 有 usage 的请求 | 服务已报告 total_tokens |
| --- | ---: | ---: | ---: | ---: |
| primary | 918 | 3067 | 2835 | 29850060 |
| cleanControls | 88 | 272 | 242 | 2680829 |
| inputPreparationExcluded | 8 | 11 | 7 | 76807 |
| coordinatorExcluded | 6 | 25 | 20 | 294426 |

这里是响应实际报告的用量，不是完整账单：中断/超时请求可能没有返回 usage，无法据此精确推算实际费用。密钥只从已有本机配置读取，未写入报告或评测记录。

## 复查文件与验证

所有原题图、完整模型作答、评分细则与明细留在被 Git 忽略的 `.runtime/exam-suite-2026-09-28/`，未公开发布。

- `report.html`：离线交互报告，搜索题号、筛选错题/失败/错答但校验通过，链接模拟图、清晰图、结果 JSON；含独立对照表。
- `results.csv`、`scores-sim.json`、`scores-clean.json`、`paired-controls.json`：逐题/逐卷评分。
- `manual-grades-sim.json` / `manual-grades-clean.json`：数值题与 AP 分项、依据、输出哈希；`error-review.json`：代表性错误解释。
- `sources.json`、`*-cases.json`、`*-truth.json`：官方来源/哈希、图像 provenance、答案与换算表。
- `runs-sim/`、`runs-clean/`、两组 `excluded-*`：真实调用及排除原因，保留 HTTP 状态/模型名/用量/脱敏诊断，不保存内部思维链。
- `prepare-*.py`、`image-preparation.py`、`run.mjs`、`score.py`、`add-grades.py`、`audit.py`：可复查的制作、调用与评分脚本。`run.mjs` 默认 dry run，付费需 `--live`；已有记录不自动重放。

实际验证：`pnpm build:server` 通过；评分器 `test-score.py` 8 项通过；`audit.py` 检查 1836 张图片的格式、EXIF、尺寸与哈希、源 PDF 哈希、冻结配置/代码/资源、所有响应模型名及评分绑定。离线报告在本机 Chrome 经 Playwright 检查 918 行、搜索/筛选、桌面和窄屏、无 JS 错误；配置中的模型密钥未出现在本地文本产物与报告。此评测未更改生产解题代码，未执行新的 APK 构建/安装，也未宣称手机端通过。最终全量审计使用 `audit.py --final`，要求所有主测及计划对照均结束并评分。

冻结资源 SHA-256：`9fa842baa78a719b1149428b3c1d4474be944e74129326f60a27977caf224bc5`；`mobile.js`：`11eafec74dea5aa1b3f0426572e936b9a757db2b08bf1cea67934871dd0c7186`。此前相机取景框样式的未提交改动保持原状，本次没有提交或推送。

## 官方来源

题面与评分分别来自以下官方公开资料；本仓库文档仅保存结果与方法，不复制整套题面。

- [sat-8 / questions](https://satsuite.collegeboard.org/media/pdf/sat-practice-test-8-digital.pdf)

- [sat-8 / scoring](https://satsuite.collegeboard.org/media/pdf/scoring-sat-practice-test-8-digital.pdf)

- [sat-9 / questions](https://satsuite.collegeboard.org/media/pdf/sat-practice-test-9-digital.pdf)

- [sat-9 / scoring](https://satsuite.collegeboard.org/media/pdf/scoring-sat-practice-test-9-digital.pdf)

- [sat-10 / questions](https://satsuite.collegeboard.org/media/pdf/sat-practice-test-10-digital.pdf)

- [sat-10 / scoring](https://satsuite.collegeboard.org/media/pdf/scoring-sat-practice-test-10-digital.pdf)

- [act-1 / booklet](https://www.act.org/content/dam/act/secured/documents/Preparing-for-the-ACT.pdf)

- [act-2 / booklet](https://www.act.org/content/dam/act/secured/documents/ACT-Test-Prep-ACT-Practice-Test-2-Form.pdf)

- [act-3 / booklet](https://www.act.org/content/dam/act/secured/documents/ACT-Test-Prep-ACT-Practice-Test-3-Form.pdf)

- [ap-calculus-ab-2024 / questions](https://apcentral.collegeboard.org/media/pdf/ap24-frq-calculus-ab.pdf)

- [ap-calculus-ab-2024 / scoring](https://apcentral.collegeboard.org/media/pdf/ap24-sg-calculus-ab.pdf)

- [ap-calculus-ab-2025 / questions](https://apcentral.collegeboard.org/media/pdf/ap25-frq-calculus-ab.pdf)

- [ap-calculus-ab-2025 / scoring](https://apcentral.collegeboard.org/media/pdf/ap25-sg-calculus-ab.pdf)

- [ap-calculus-ab-2026 / questions](https://apcentral.collegeboard.org/media/pdf/ap26-frq-calculus-ab.pdf)

- [ap-calculus-ab-2026 / scoring](https://apcentral.collegeboard.org/media/pdf/ap26-sg-calculus-ab.pdf)

- [ap-statistics-2024 / questions](https://apcentral.collegeboard.org/media/pdf/ap24-frq-statistics.pdf)

- [ap-statistics-2024 / scoring](https://apcentral.collegeboard.org/media/pdf/ap24-sg-statistics.pdf)

- [ap-statistics-2025 / questions](https://apcentral.collegeboard.org/media/pdf/ap25-frq-statistics.pdf)

- [ap-statistics-2025 / scoring](https://apcentral.collegeboard.org/media/pdf/ap25-sg-statistics.pdf)

- [ap-statistics-2026 / questions](https://apcentral.collegeboard.org/media/pdf/ap26-frq-statistics.pdf)

- [ap-statistics-2026 / scoring](https://apcentral.collegeboard.org/media/pdf/ap26-sg-statistics.pdf)

- [ap-english-language-2024 / questions](https://apcentral.collegeboard.org/media/pdf/ap24-frq-english-language-set-1.pdf)

- [ap-english-language-2024 / scoring](https://apcentral.collegeboard.org/media/pdf/ap24-sg-english-language-set-1.pdf)

- [ap-english-language-2025 / questions](https://apcentral.collegeboard.org/media/pdf/ap25-frq-english-language-set-1.pdf)

- [ap-english-language-2025 / scoring](https://apcentral.collegeboard.org/media/pdf/ap25-sg-english-language-set-1.pdf)

- [ap-english-language-2026 / questions](https://apcentral.collegeboard.org/media/pdf/ap26-frq-english-language.pdf)

- [ap-english-language-2026 / scoring](https://apcentral.collegeboard.org/media/pdf/ap26-sg-english-language.pdf)

AP 作文事实复核另参考 [Roland-Garros 2021 公告](https://www.rolandgarros.com/en-us/article/on-behalf-of-the-grand-slams-we-wish-to-offer-naomi)、[Nobel 2005 医学奖说明](https://www.nobelprize.org/prizes/medicine/2005/press-release/)。
