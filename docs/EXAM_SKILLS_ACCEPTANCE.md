# SAT / ACT / AP 专项解题优化

日期：2026-09-17。版本：0.1.22 / versionCode 23；代码、真实模型、APK及安卓原题流程验收已完成。

## 范围

新增受审 exams Skill 与 SAT、ACT、AP 三份按需参考，组合已有学科 Skill。明确考试名称的题图或补充说明触发对应方法；没有来源的英文题不被擅自认定为某场考试。不增加供应商、固定模型或新工具，也不增加繁琐设置页。用户可在拍题补充说明写“SAT数学”“ACT Science”“AP Calculus AB”等。

- SAT：检查真正所求、选项对应、SPR填答格式；英语题按材料证据、语篇关系和语法判断，不靠关键词猜答案。
- ACT：保留原选项标签与NO CHANGE；科学题区分读数据、实验设计和不同观点，不用课外常识替代题内证据。
- AP：按科目和原小问作答；justify、show work、单位、必要图示仍在首轮答案中保留。完整教学推导按需展开。不虚构本题rubric、逐点分值、满分或总分预测。

涵盖数学/统计、理化生/环境、经济、人文社会科学、语言艺术、计算机方法检查，不能据此声称所有AP课程和复杂题型准确率已通过验收。图形只使用现有受控结构；缺失作品、音频、材料或评分细则时不猜造。

沿用0.1.21的默认简洁答案、结果加粗、按需步骤、手动校验、历史版本选择和图文稳定性修复，见[详细记录](ON_DEMAND_ANSWER_ACCEPTANCE.md)。AP必要作答依据优先于“通常1–3句”的默认长度建议，不能因折叠教学步骤而漏掉题目本身要求。

## 官方依据

以下是实现前核对的方法依据，不是题库授权、实时查询能力或当前题的官方答案；Skill使用自主编写摘要，真实评测使用自编图片。

- [SAT内容领域](https://satsuite.collegeboard.org/higher-ed-professionals/sat-validity/content-domains)：阅读写作的证据、语篇、修辞目标和语言规范，以及数学范围。
- [SAT学生填答](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/student-produced) 与 [数字SAT框架附录D](https://satsuite.collegeboard.org/media/pdf/assessment-framework-for-digital-sat-suite.pdf)：SPR可能只需一个合法值；按题面格式填写，不把精确分数过早近似。
- [ACT English](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/description-of-english-test.html)：结合句子、段落和修辞目标判断替换项。
- [ACT Science](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/description-of-science-test.html)：数据、实验与论证的判断；未把网页中可能变化的题数、时长写死。
- [AP官方评分说明](https://apcentral.collegeboard.org/courses/how-ap-develops-courses-and-exams/score-setting-and-scoring) 与 [2026 Calculus AB评分指引](https://apcentral.collegeboard.org/media/pdf/ap26-sg-calculus-ab.pdf)：具体题的必要依据和评分点依赖本题；不将一科的精度要求泛化为所有AP。
- [AP Biology考试](https://apcentral.collegeboard.org/courses/ap-biology/exam) 与 [AP计算器政策](https://apcentral.collegeboard.org/exam-administration-ordering-scores/administering-exams/preparing-for-exam-day/calculator-policy)：按实际科目、任务和题面条件处理实验、图表与工具许可。

## 实现与离线验证

- packages/agent/resources/skills/exams/：主体方法与三份参考；其他学科Skill同步明确brief/detailed及用户主动校验。
- packages/agent/resources/SYSTEM.md、VERIFIER.md：识别明确考试来源，保留必要证据，限制评分声明。
- packages/agent/src/pi/approved-skills.ts、scripts/prepare-mobile-agent.mjs：服务端与本地包使用显式受审清单，未扩大工具权限。
- 新增三项通过真实Pi SDK/受限read加载考试正文和参考的离线探针，覆盖身份隔离和预算；总计70文件634项单元/合约测试通过。
- pnpm build：三端JS/Hermes与本地DOM资源导出通过。pnpm typecheck及lint通过；原生APK编译、同签名验证、4项真实私密配置扫描及实际包内DOM渲染检查通过。

## 真实验收

命令：node scripts/exam-skills-live.mjs --live。读取项目现有配置，只在明确live参数下付费。八道自主编写英文JPEG，人工确定解析真值，记录实际Skill/read调用，再把真实结果放入RN Web检查320px亮暗渲染；不是用另一个模型的PASS代替真值。

样例覆盖：SAT分数填答、SAT转折；ACT数据插值、ACT主谓一致；AP微积分存在性论证、AP统计观察与因果、AP生物实验小问、AP微观供需图。

最终报告：`.runtime/exam-skills-2026-09-17T08-06-00-722Z/report.json`，8/8通过；每项实际调用受限read加载exams正文及对应参考，默认不调用Verifier。

| 自编题 | 真值/必要依据 | 耗时 |
| --- | --- | --- |
| SAT SPR | 7/3，保留精确填答 | 7560ms |
| SAT 转折 | B / However，语篇对比依据 | 5339ms |
| ACT 数据 | 原标签H，10 mm/day | 9427ms |
| ACT 英语 | B / is，主谓一致 | 6568ms |
| AP 微积分 | 连续性、端点异号、介值定理 | 6843ms |
| AP 统计 | 观察相关不能证明因果，混杂因素 | 85149ms |
| AP 生物 | 下降75%，细胞数量控制；保留(a)(b) | 7596ms |
| AP 微观经济 | (4,6)→(6,8)，三条曲线与两均衡同图 | 28527ms |

全部真实结果通过320px亮暗渲染检查。人工检查微积分的必要论证及经济图，曲线/点标记可读。AP经济题发生一次JSON格式修复，仍在原有一次修复预算内；不能将其描述为首次输出结构即合格。

首轮报告`.runtime/exam-skills-2026-09-17T08-00-14-906Z/report.json`保留2通过/6失败。实际问题包括未加载对应参考、经济比较拆成两图；已强化显式考试规则和同图要求。另修正两个不合理评测限制：ACT跨学科科学题可以归general而非强制biology；微积分端点计算允许等价中间表达式。没有降低数学真值、必需论证或图示要求。

命令`node scripts/exam-verifier-live.mjs --live --directory=.runtime/exam-skills-2026-09-17T08-06-00-722Z`使用实际AP微积分候选及同图做正反例：完整论证PASS（3453ms）；人为删除依据、仅保留Yes的候选FAIL（14821ms）。说明“简洁”没有导致校验漏掉本题justify要求，不代表所有错误都能被检出。

## 安装包与边界

0.1.22 / code23，43,779,193字节；SHA256 `efdcb360b78ae5a854dfd663055af8cb3cc961d2c891cee396614ca0e0afef2f`。`pnpm mobile:apk`首次遇到已有Android模块的lint内部KaModule错误；重新执行原命令成功，没有禁用lint。`node scripts/test-android-document.mjs`实际解包检查通过；同签名、Hermes/SQLite/本地资源、无服务端.env/私密配置均验证通过。用户返回应用后，已同签名覆盖安装到iQOO Neo9，读回0.1.22/code23。原题真实解答、按需步骤、主动校验与冷启动恢复通过，详见[真机记录](ON_DEMAND_ANSWER_ACCEPTANCE.md#0122-最终真机验收)。考试八样例仍为同一核心的Node实测，不冒充八题都在手机重新执行。

这些是有限的自编样例验收，没有进行官方整卷、总分预测、长篇作文或全部AP课程准确率评估。统计题仍出现85秒响应，模型等待存在波动，不能保证所有题都快速完成；没有更换或写死模型。未进行iOS原生构建，也未重新做本版全程息屏验收。
