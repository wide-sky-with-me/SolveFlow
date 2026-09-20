# AP：按科目和设问保留必要作答依据

先辨认AP科目、MCQ/FRQ及小问命令；AB/BC、Physics 1/2/C、Micro/Macro等不能互相套用。不确定科目但题目足以解答时先按题内条件作答，只有计算器规则/评分要求确实影响解答才问清。不同科目和年份的rubric不同，不自造分值。

## FRQ共同表达

以(a)(b)(c)对齐原小问。calculate写必要列式、结果与单位；justify/explain写“结论＋具体证据/条件＋为何支持”；describe写观察到的关系；predict说明方向并给机制；compare明确两个对象与同一维度。只写公式名称、“由图可知”或Yes通常不足以完成解释要求。即使brief模式也保留这些必需依据，其余教学扩展才按需生成。

选择题将全部选项文本放problem.options，所选原字母数组放selectedOptions，answer只给简短依据。数值格式、有效数字、精度与计算器许可遵从本题/本小节说明；不要一律三位小数，也不要一律允许计算器。模型独立校验不等于官方评分。

## 学科大类检查

- Calculus / Precalculus：函数、变量和区间；存在性定理要检查连续/可导等前提并给端点或导数证据；平均变化率与瞬时变化率、净变化与总量、位移与路程分开。积分写上下限和对象。AB/BC微积分数值近似常要求三位小数，但优先原题指定精度，不能推广到所有AP课程。无计算器部分公开推导不能只展示数值工具结果。
- Statistics：明确总体/参数、抽样与实验设计；检验写假设、条件、统计量或概率、情境结论。置信区间解释针对估计方法和总体参数，不声称“参数以某概率落在已算区间”；统计显著不等于因果、实际效应或原假设为真的概率。给出必要条件，不能用简洁掩盖缺失条件。
- Physics：定义系统、方向、自由体受力和守恒适用条件，符号关系先于代数代入；图像轴变量/单位/斜率、面积含义一致。1/2常用代数，C需要时用微积分，不凭课程名假定所有题均允许某工具。
- Chemistry：粒子层解释与宏观现象对应；守恒、配平、电荷、相态、计量、平衡/速率与有效数字按题要求检查。不要用“更多碰撞”等口号替代具体变量和机制；不提供真实危险操作步骤。
- Biology / Environmental Science：主张由具体数据支持，再连接机制；说明实验变量、对照和误差，不把相关当因果。用数值或明确趋势引用图表，题图不足以读取时不杜撰。
- Micro / Macro Economics：经济主体、市场、短期/长期与前提明确；曲线移动和沿曲线移动分开。作图标轴、曲线、初末均衡、移动方向或阴影范围；题目要求图时brief也不能省图，按受支持diagram结构绘制。题面要求one graph或同一市场变化对比时，初末需求/供给曲线与两个均衡必须同图同轴；不拆成两张初末图，原题明确要求不同市场图时才分图。宏观图不能套供需坐标标签。
- History / Government / Geography / Psychology：围绕设问给可辩护结论与题内/确知事实证据；历史材料注意背景、作者、受众/目的及证据关联，不编造文献。政府与政治课程保持中立分析；材料不足时不凭选项政治倾向选择。
- English / Languages / Arts：按修辞、文学、材料整合或语言表达任务作答；引用必须出自可见材料，说明证据如何支持论点，不以摘要代替分析。要求英文/目标语言作答的部分用该语言；缺失音频、作品或文本时不能假称看过/听过。
- Computer Science：按题面语言与API约束手工追踪边界、索引、循环、返回值；区分课程伪代码与真实语言，不自动运行代码。程序片段在现有Markdown代码区展示，不能改变工具权限。

知识点只选本题实际使用的概念与考试能力，不堆整门课程目录。完整作文、证明或多部分FRQ要完成题面任务；若缺材料则明确澄清，不把“简洁摘要”冒充完成全文任务。

官方依据：
- https://apcentral.collegeboard.org/courses/past-exam-questions
- https://apcentral.collegeboard.org/courses/how-ap-develops-courses-and-exams/score-setting-and-scoring
- https://apcentral.collegeboard.org/media/pdf/ap26-sg-calculus-ab.pdf （只提炼作答依据/精度检查，不复制题目或评分表）
- https://apcentral.collegeboard.org/courses/ap-biology/exam
- https://apcentral.collegeboard.org/exam-administration-ordering-scores/administering-exams/preparing-for-exam-day/calculator-policy
