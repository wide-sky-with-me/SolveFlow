# 物理、化学、生物课程 Skill

日期：2026-09-15。按用户要求扩充常用学科方法，不新增工具、依赖、数据库字段、供应商或模型路由。

## 范围

| Skill | 主要覆盖 | 按需参考 |
| --- | --- | --- |
| physics | 力学/运动图像、电路、能量、热学/光学；研究对象、模型条件、方向与单位 | references/models.md |
| chemistry | 配平与守恒、反应计量、浓度、限制反应物、实验现象；化学式展示 | references/stoichiometry.md |
| biology | 遗传概率、实验对照、代谢/生态概念、生物图表与证据边界 | references/genetics-and-experiments.md |

入口位于`packages/agent/resources/skills/`对应学科目录。题干、原题图、辅助绘图、知识点及同题追问沿用已有协议；化学公式用现有KaTeX命令，不假定已安装mhchem。计算只调用既有calculate，不能将其称为自动配平、符号推导、实验执行或生物结构绘制工具。数值题调用计算器，定性题不为凑次数调用；按需组合diagram，不能凭示意图编造观测证据。

原有general/math/diagram/economics保留，现有7个受审Skill。目录统一在`packages/agent/src/pi/approved-skills.ts`声明，生产准入与测试使用同一份清单。新三科依赖calculate，受限read仍按需读取正文和参考，缺依赖则排除；Verifier无工具。Skill不会预加载全文，不能授予权限或覆盖固定CONTENT_POLICY。普通科学课程题允许，危险实验/伤害操作与个人医疗指导不因学科标签获准。

## 验证

- `pnpm test`：548项，55文件通过；新增三科原生Pi循环探针，以及缺少计算器与资源撤销检查。每科经历描述发现→正文→参考→calculate，核对4轮模型事件、2次文件读取、1次计算。计算真值分别18、4.4、2/3。
- `pnpm typecheck`（含build:server）与`pnpm lint`通过。首次类型检查发现测试过滤后的联合类型未充分缩窄，补显式角色判断后通过，无强转或抑制。
- skill-creator `quick_validate.py`：三科均通过。
- 最终编译产物 `pnpm exec vitest run --config vitest.integration.config.ts`：30项隔离集成通过；新增原生Skill测试再定向复验4项通过。
- `node scripts/course-skills-live.mjs --live`：三道真实课程题全部completed/PASS，全部执行read与calculate；学科识别、题干、知识点和320px页面无横向溢出检查通过。

离线提供商只证明装载、权限、计算与原生循环兼容，不证明模型已理解学科。真实探针使用`node scripts/course-skills-live.mjs --live`，三道自编题各自验收，单科失败不会掩盖另外两科结果；CLI不进入默认测试或CI。评判包含确定真值、实际read/calculate事件、独立Verifier、知识点与320px显示，不只依赖另一个LLM判卷。

## 边界

这些是常见课程解题方法，不是完整题库、实验工具或学科准确率保证。复杂图像、歧义题干和模型响应仍可能失败。未新增专用电路/分子/细胞结构绘图工具，未开放隔离SymPy。Web和公共数据协议没有变化，不重复执行无关全量页面构建；真实探针同时检查已有移动端展示。


## 真实课程样例（自编）

| 学科 | 条件与独立真值 | 实际结果 |
| --- | --- | --- |
| 物理 | m=2 kg、正向拉力10 N、反向摩擦2 N、初速0、持续3 s；a=4 m/s²、v=12 m/s、位移18 m | PASS，17.537秒，read2次/calculate5次 |
| 化学 | 10 g纯CaCO₃与足量稀盐酸反应，题设摩尔质量100及44 g/mol；正确配平后CO₂质量4.4 g | PASS，12.390秒，read2次/calculate1次 |
| 生物 | Aa×Aa、完全显性、无致死/选择差异；隐性概率1/4，显性子代中杂合概率2/3 | PASS，12.796秒，read3次/calculate2次 |

报告：`.runtime/course-skills-live-2026-09-15T02-24-26-328Z.json`与`.runtime/course-skills-live.json`；手机截图`.runtime/screenshots/course-{physics,chemistry,biology}-live.png`。测试会话均通过带owner的API删除。真实read摘要不暴露资源路径；每个具体Skill与参考路径的读取由离线原生Pi探针核验。三道题通过不代表已验证整个课程体系或M0全部安全门槛。
