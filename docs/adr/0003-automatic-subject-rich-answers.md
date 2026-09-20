# ADR 0003：自动科目与可校验的图文答案

2026-09-10，用户明确要求上传后自动识别/纠正科目，并增强公式、图片与模型绘图。此决定调整原先可选科目操作，不扩大模型的文件、网络或代码执行权限。

上传表单不再选择学科。新会话默认general，旧HTTP subject字段兼容保留为提示；Solver根据原题填写实际problem.subject，不能因提示不匹配拒答。结果、科目、终态和SSE事件在同一数据库事务更新，先锁session再锁run，与删除锁顺序一致；迟到或取消结果不能改科目。没有新增表或破坏性迁移。

采用react-markdown 10.1.0、remark-gfm 4.0.1、remark-math 6.0.0（均MIT、精确锁定）解析段落、列表、表格及数学语法，复用已有KaTeX 0.18.7渲染。支持$…$、$$…$$与模型常用的\\(…\\)/\\[…\\]；代码块中的分隔符保持原样。公式独立滚动，限制2000字符、maxExpand=100、maxSize=20、trust=false；失败显示源码。Markdown不执行raw HTML，链接显示文字。Markdown图像只接受attachment:original，映射到当前会话已授权的同源图片接口；任意外部URL和其他会话路径均不被加载。

图示以答案的可选figures数组扩展version 1，旧持久结果无需迁移；新的消费端须同步部署共享schema。每幅图有自身schemaVersion、标题、描述、范围与元素，最多3图、每图24元素、坐标绝对值不超过10000。支持点、线段、圆、最多三次多项式（系数按常数项到最高次项）；前端React生成SVG并保持等比例，不接受模型返回的任意SVG、HTML、脚本、路径或URL。图例和描述提供文字替代，不以示意比例证明答案。该能力尚不覆盖任意插画、复杂化学结构或任意函数。

新增白名单diagram技能与按需参考资料，使用既有read，不新增模型工具或网络服务。Verifier仍独立看原图，并核查图文、坐标和系数；带图答案PASS必须包含diagram检查项，运行时解析和最终结果契约均强制约束。无有效图示核验不得标已验证。

官方依据：[react-markdown](https://github.com/remarkjs/react-markdown)、[remark-math](https://github.com/remarkjs/remark-math)、[KaTeX选项](https://katex.org/docs/options)。研究过Mermaid安全模式，本次函数/坐标图不需要引入额外DSL引擎。
