# ADR 0010：题干原图、知识点与受控教学绘图

日期：2026-09-14。状态：按用户本次要求实施，不新增框架或工具权限；Agent包复用仓库已有Sharp 0.35.4。

## 问题与决定

原识别题干默认折叠，多题共享总题干；原题局部图没有独立定位；知识点只有名称，无法直接展开和定向追问。改为每题答案之前默认展示完整题干，桌面将原题局部图放在旁边，手机纵向排列。模型按原图归一化坐标输出 `problem.illustrations`，前端以已有私有图片地址和上传尺寸裁出可视区域。裁图保留原始像素，不让模型生成地址，不创建公开图片。

区分原题图和新增解答图。保留已有坐标图渲染，增加轴名称/单位、独立轴比例、折线和多边形区域，覆盖分段/采样函数、供需均衡与剩余面积。结构只包含有界数字、文本和枚举，无任意表达式执行、SVG代码或外部图片URL。几何默认等比例；非等比例只用于不同单位的轴，不能用屏幕斜率代替数值斜率。

`knowledgeDetails` 表达概念含义、使用条件、本题应用及易错点。UI 默认收起详情，点击追问将 `knowledge` 来源引用绑定到题目对话，在本题输入框预填问题，保留已有草稿。服务端只接受已保存的知识点名称，不能由客户端提交新的“知识正文”。原 owner/session 校验、幂等及历史隔离继续适用。

## 协议与兼容

候选协议继续 schemaVersion=1，新增可选字段以读取历史数据：单题 `problem.illustrations`、`knowledgeDetails`；多题 `questions[].problem`、`questions[].knowledgeDetails`。每题展示投影仅选择本题题干、知识点、步骤与图，不改写已存整轮校验。新提示要求完整生成；旧记录缺少裁片和说明时只显示已有内容，不能假造或后台自动付费重算。JSONB 无需表迁移。

追问 context 增加 `kind:knowledge`、`sourceRunId`、`name` 与可选 `number`，兼容已保存的 step/question/correction/reply。同题链继续由服务端解析；新旧前端应随 API 一起发布。

有原题裁片或解答图的 PASS 均须包含独立 diagram 核验。Verifier 同时核对题干完整性、裁片位置/标记、知识说明、图轴与阴影边界。机器边界校验只能阻止越界，不能证明视觉裁片一定准确。

## 参考与取舍

- [K-Dense scientific-visualization Skill](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/scientific-visualization/SKILL.md)：参考单位、数据语义、图注和可访问性检查。其 Python/Bash/文件写入能力不适合直接开放给学生 Agent；未安装或复制该执行环境。
- [SymPy 数值计算](https://docs.sympy.org/latest/modules/evalf.html)：区分数值近似与符号结论。当前产品用已有受限 `calculate` 验算，隔离 SymPy 服务未验收，不宣称能调用它。
- [Vega-Lite](https://vega.github.io/vega-lite/docs/) 与 [区域图说明](https://vega.github.io/vega-lite/docs/area.html)：参考结构化绘图和边界区域表达。目前图形规模小，沿用既有 React/SVG 数字协议，不增加浏览器依赖和第二套渲染流程。

更新 diagram/math Skill，新增受审 economics Skill。全部通过固定 manifest 和 read 按需加载；diagram/economics 依赖 calculate。新增 Skill 不授予代码运行、文件写入或网络权限。时间、轮次、总图数及工具预算保持不变。

## 限制

多项式仍最多三次；一般曲线用有界采样折线并声明近似，不能跨无定义点连线，也不能用采样面积冒充精确积分。复杂三维、统计图、任意符号求解尚未实现。实际结果和验收见[本次验收记录](../LEARNING_CONTENT_ACCEPTANCE.md)。


## 真实验收发现后的补充

首轮真实数学题出现knowledgeDetails缺失及错误裁框，即便模型Verifier返回PASS。新生成JSON Schema改为要求知识详情及逐题题干，历史解析仍宽容缺字段；应用Verifier阶段增加确定性完整性检查，缺字段不能PASS，沿既有一次修正流程处理。

增加服务端视觉证据：原图保持不变；另提供标记每0.1坐标的辅助副本，并向Verifier提供按模型框实际裁出的像素，说明这些才是前端展示区域。所有图片处理仅使用授权内存图，固定数字SVG网格，无模型代码/路径/URL输入；单次操作Sharp timeout 3秒，输入像素≤2048²、补充图片合计≤4MiB，取消前后检查，外层worker总时限不变。多题裁片数量受既有每题3个、最多4题约束。

Agent增加对已有Sharp 0.35.4的直接依赖，锁文件固定版本不升级；离线安装下载0包，不增加浏览器包。许可为[Apache-2.0](https://github.com/lovell/sharp/blob/main/LICENSE)，锁定版本本地已有API上传使用，版本文档见[Sharp合成API](https://sharp.pixelplumbing.com/api-composite/)。这不是学生工具，不开放写入或任意执行。额外视觉输入会增加模型输入量，仍使用环境中的模型容量与既有总预算。

裁图边界由contracts中的共享函数统一增加原图宽/高3%的留白并限制在0–1；前端SVG与Verifier像素裁片使用同一结果，避免模型紧框切掉附近单位/顶点标记。留白也可能含邻近内容，复杂密集题仍需独立核验题目归属。
