# 题干、原题图、知识点与教学绘图验收

日期：2026-09-14。范围见[ADR 0010](adr/0010-question-learning-content.md)。

实现与确定性验收已完成：544项离线、30项隔离集成、34项桌面/移动浏览器测试通过。真实数学题的题干、原题裁片、辅助图及知识点展示通过；真实经济题与知识点追问通过。数学题后续一次追问遇到模型请求中断，不能宣称全部真实追问稳定通过。

## 实现

- 每题答案上方默认显示完整题干与公式，多题使用各自的题干。原题局部图来自授权上传图，桌面并排、手机上下排列，支持放大与容器内滚动。
- 原题裁图使用共享的边界函数，增加原图宽/高3%留白并限制在原图内。Solver另获坐标辅助副本；Verifier接收原图、辅助图及按同一边界实际裁出的像素，检查文字标记是否完整。
- 知识点展开显示含义、应用、易错处；定向追问进入本题输入框及历史链。服务器核对已保存的知识名称，拒绝伪造和跨owner/session引用。
- 图形新增轴标签/单位、不同单位轴比例、折线、多边形阴影。math/diagram Skill更新并新增economics，数值检查使用实际calculate工具。
- 原题图或解答图的PASS须含独立diagram检查。新生成Schema要求知识详情及逐题题干，历史数据保持兼容；确定性完整性检查可否决错误PASS，并沿既有一次修正流程处理。新增DIAGRAM核验问题码。
- 不增加模型/供应商、Agent框架或学生端执行工具；Agent包复用仓库已有Sharp 0.35.4，离线安装下载0包，不增加浏览器体积。

最新用户数学记录只读结构检查：completed，没有figures、problem.illustrations或knowledgeDetails。旧记录显示已有题干与知识点名称，未自动付费重算或改写用户记录。

## 确定性验证

| 命令 | 实际结果 |
| --- | --- |
| `pnpm test` | 544项，54文件通过 |
| `pnpm test:integration`；最终构建后 `pnpm exec vitest run --config vitest.integration.config.ts` | 30项通过，随机隔离PostgreSQL/MinIO |
| `pnpm test:e2e`（先启动demo） | 最终34项通过；另对裁图和知识点进行定向回归 |
| `pnpm typecheck`、最终 `pnpm exec tsc --noEmit` | 通过 |
| `pnpm lint`、`pnpm build` | 通过 |
| skill-creator `quick_validate.py` | diagram/math/economics通过 |

覆盖原题裁框合法性与留白像素一致性、只读原图、取消、知识点来源与跨题隔离、缺字段仍返回PASS时的强制修正、数据库持久化、图示错误契约，以及320px布局、授权图片地址和刷新后的题内追问。

浏览器首次有2项旧“展开题干”定位失败，更新为默认可见断言后通过。收尾曾把依赖demo的裁切测试选入真实服务回归，两端均在找不到“试试示例题”按钮时停止，没有创建题目/调用模型；已增加明确模式保护，并切回demo完成34项回归。UI fixture不等于真实模型接通。

## 真实测试

命令：`node scripts/learning-content-live.mjs --live`，支持`--math-only`或`--economics-only`。使用环境变量中的模型、供应商与端点；全部为自编题，测试会话已删除，用户原记录保留。

| 场景 | 结果与独立检查 |
| --- | --- |
| 直角三角形AB=3、AC=4 | 14.935秒，PASS；BC=5、面积6；实际calculate2次。完整复述、原图A/B/C与3cm/4cm标记、辅助图、3个知识点及320px显示检查通过 |
| 该数学题的知识点追问 | 20.259秒，failed/INTERNAL_ERROR；Solver stopReason=error，保留失败，未冒充完成 |
| 需求P=14−Q、供给P=2+2Q | 50.087秒，PASS；均衡(4,10)、消费者剩余8、生产者剩余16。按渲染多边形坐标独立计算面积也是8和16；calculate8次 |
| 经济题知识点追问 | 12.061秒，PASS，calculate4次；context.kind=knowledge、sourceRunId指向本题，刷新后仍在同一题框中 |

实际网页结果另做手机端局部回放，确认教学步骤、公式、原题图和辅助图可见；宽公式在自己的容器内滚动，不撑宽页面。

原始报告（忽略目录内）：
- 经济及追问：`.runtime/learning-live-2026-09-14T15-41-33-560Z.json`。
- 数学及追问：`.runtime/learning-live-2026-09-14T15-43-44-764Z.json`，整体passed=false，不能据数学主解答通过宣称整轮通过。
- 截图：`.runtime/screenshots/learning-math-live.png`、`learning-math-figure-detail.png`、`learning-math-step-detail.png`、`learning-economics-live.png`。

前三轮失败也保留：首轮漏knowledgeDetails且裁框错误；第二轮漏掉边缘数字；第三轮Verifier错误码不符，安全标记未验证。对应修复是新生成必填与确定性检查、坐标辅助/实际裁片、共享留白及DIAGRAM错误类型，没有降低真值或裁图完整性门槛。

## 边界

1. 复杂图形的定位仍依赖模型视觉判断；网格、留白和独立核验不能保证所有裁片准确，密集多题还可能包含邻近内容。
2. 原照片清晰度决定裁片质量；旧记录缺字段不会自动补齐。
3. 一般曲线使用有界采样并声明近似，不替代精确证明；隔离SymPy、三维图、任意代码绘图尚未开放。
4. 模型请求仍可能中断/超时。失败与未验证状态保留，不保证模型答案正确。
5. 同题一次活动run、最多10轮等运行约束不变；金额额度默认无限。
