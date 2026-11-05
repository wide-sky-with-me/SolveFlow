# 中心考试模板与题型

规则快照由[目录](../../packages/contracts/src/exam-catalog.ts)拥有，核对日期为2026-11-03。管理端“考试安排 → 选择考试模板”生成可发布版本；开始考试时冻结到模块快照，后续模板变化不影响已有题位。这里只管理拍题流程，不代替官方考试软件。

## 已核对的目录

| 考试 | 模块、题数和标准分钟数 | 配置差异 |
| --- | --- | --- |
| SAT Digital | 阅读写作27/32、27/32；数学22/35、22/35 | 数学允许单选和填答；第二模块自适应由真实考试决定，本系统不生成路由或精确分数 |
| ACT Enhanced | English50/35、Math45/50、Reading36/40 | 选加Science40/40、Writing1/40；不把未计分题从拍摄题位中扣除 |
| ACT Legacy练习 | English75/45、Math60/60、Reading40/35、Science40/35 | 与新版分开；可选Writing1/40 |
| ESAT | Mathematics 1必考，各科27/40 | 按实际报考选Biology、Chemistry、Physics、Mathematics 2；多数课程再选两科，但不强制所有课程同一组合 |
| TMUA | 两卷各20/75 | 均为选择题，无计算器 |
| TARA | 批判性思维22/40、问题求解22/40、写作1/40 | 写作3选1，最多750词；只有一个写作题位 |

来源：[SAT结构](https://satsuite.collegeboard.org/sat/whats-on-the-test/structure)、[SAT计分](https://satsuite.collegeboard.org/scores/what-scores-mean/how-scores-calculated)、[新版ACT](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/act-exam-sections-and-structure.html)、[旧版ACT](https://www.act.org/content/dam/act/unsecured/documents/act-test-content.pdf)、[ESAT](https://esat-tmua.ac.uk/about-the-tests/esat-test/)、[TMUA](https://esat-tmua.ac.uk/about-the-tests/tmua-test/)、[TARA](https://esat-tmua.ac.uk/about-the-tests/tara/)。

## AP按课程和年份

不能使用统一“AP题数”。当前内置以下12门课程的May 2027结构；其中微积分、物理和统计与旧版不同。旧素材须用明确填写的自定义模板，不能直接套2027版本。

| 官方课程 | 选择题数/分钟 | 解答题数/分钟 |
| --- | --- | --- |
| [Calculus AB](https://apcentral.collegeboard.org/courses/ap-calculus-ab/exam)、[BC](https://apcentral.collegeboard.org/courses/ap-calculus-bc/exam) | A29/62，无计算器；B13/38，需计算器 | A2/30，需计算器；B4/60，无计算器 |
| [Physics 1](https://apcentral.collegeboard.org/courses/ap-physics-1/exam)、[2](https://apcentral.collegeboard.org/courses/ap-physics-2/exam)、[C Mechanics](https://apcentral.collegeboard.org/courses/ap-physics-c-mechanics/exam)、[C E&M](https://apcentral.collegeboard.org/courses/ap-physics-c-electricity-and-magnetism/exam) | 42/85 | 4/95 |
| [Chemistry](https://apcentral.collegeboard.org/courses/ap-chemistry/exam) | 60/90 | 7/105 |
| [Biology](https://apcentral.collegeboard.org/courses/ap-biology/exam) | 60/90 | 6/90 |
| [Statistics](https://apcentral.collegeboard.org/courses/ap-statistics/exam) | 42/90 | 4/90 |
| [Computer Science A](https://apcentral.collegeboard.org/courses/ap-computer-science-a/exam) | 42/90 | 4/90 |
| [Microeconomics](https://apcentral.collegeboard.org/courses/ap-microeconomics/exam)、[Macroeconomics](https://apcentral.collegeboard.org/courses/ap-macroeconomics/exam) | 60/70 | 3/60，含阅读时间 |

其余AP课程及“未指定考试”通过自定义模板明确填写模块和题型，不假设固定结构。口语、听力、作品集、官方评分量表及所有AP课程的自动配置不在当前拍图目录内。计算器显示为“按科目规则”时没有替管理员确认具体型号/工具。

## 作答适配

模块保存学科、允许题型、时长、计算器规则、备选写作题数和词数限制。worker把学科与模块范围作为题目背景传给现有Agent；原图和补图仍是核验依据。返回的填数值、完整作文和多小问保存在原始结构中；多小问不能拆成新题位。老师手动确认保留正文和原选项，不会伪造AI核验PASS。

返回题型不在模块范围、同题位返回多道独立题、或正文超过模块词数限制时，保留原始结果供排查，暂停发布并生成红色问题。时长与计算器信息仅作参考，不拦截学生手机上的其他应用或计算器。新增模板和假模型测试不能证明真实题图识别准确率，实际评测须单独授权。
