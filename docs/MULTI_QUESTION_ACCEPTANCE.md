# 多题分组与教学步骤验收（2026-09-14）

用户要求按题拆分，避免反复出现第一题/第二题/第三题，并将图示限定在所属题内。保存记录的原结构是4题、12个平铺步骤、1幅图；模型在各步骤标题重复题号，前端全局编号并在全部步骤后放图。

## 修改

- `packages/contracts/src/agent.ts`：v1增加可选questions元数据，题号、题内结论、有序stepIds和figureIds。运行时拒绝重复题号、未知/重复/遗漏归属；继续共用原全局步骤ID与Verifier引用，总步骤/图示/运行预算未放宽。
- `apps/web/lib/question-sections.ts`与`components/answer-content.tsx`：逐题展示方法和推导、图示、结论。步骤题内编号、标题公式渲染；旧记录仅在全部归属明确时转换为分组视图，不改存储内容和校验状态。
- `packages/agent/resources/SYSTEM.md`、`VERIFIER.md`与general/diagram Skill：明确指定最多4题可以作答，逐题展开关键推导并核验覆盖、选项与图示，禁止把整页照片反复当作各题插图。展示教学步骤，不提供内部思维链。
- `apps/api/src/history.ts`、`worker.ts`：多题追问保留各题结论，避免新结构顶层概述覆盖历史答案；仍受原长度/字节限制。
- 无新增依赖，无数据库列变更，不修改环境模型或供应商，不改写用户历史答案。范围与兼容策略见[ADR 0006](adr/0006-question-groups.md)。

## 确定性与页面验证

- `pnpm lint`、`pnpm typecheck`、`pnpm build`通过（含Next生产构建）。
- `pnpm test`：50文件、516项通过。初次沙箱阻止本地测试端口，允许本地监听后执行；另修复了Skill描述变化对应的探针断言及新增可选字段的严格类型问题，没有删除断言。
- `pnpm exec vitest run --config vitest.integration.config.ts`：23项通过，使用隔离DB/桶。
- `pnpm test:e2e`：20项通过，使用演示服务与标注为fixture的结果回放。覆盖旧/新四题分组、每题编号重启、标题公式、图示归属、320px不溢出，以及上传、SSE、追问、刷新、删除、危险内容过滤等既有回归。
- general与diagram Skill均通过skill-creator的`quick_validate.py`，真实行为另以模型流程验收。
- 用户指定的既有记录只读回放：4题、12步、图归第4题，步骤标题重复题号去除，320px无页面溢出。未重新求解或重新认证该记录；回放图片使用占位，不复制用户原图。截图仅存于忽略目录`.runtime/screenshots/user-answer-grouped-*.png`。

Next首次在沙箱内构建触发Turbopack本地端口EPERM；移走失败构建缓存后，在允许本地端口的环境完成生产构建。

## 真实模型验证

显式命令：`node scripts/multi-question-live.mjs --live`。只使用环境变量中配置的真实Solver/Verifier，不指定固定型号。自编四题分别为方程、二次函数、概率、长方形计算，真值由算术和图示系数/坐标断言核对；测试完成只删除自建会话。

真实运行`0d55324b-d412-4c78-8037-8fece3e57490`在67.474秒完成，Verifier PASS，4题分别2/3/2/2步，唯一图归第2题。独立真值断言通过：x=5；二次函数系数[3,-4,1]、顶点(2,-1)与零点(1,0)/(3,0)；红球概率3/5；面积40、周长26。真实页面桌面、390px/320px、刷新与分题图示检查通过，测试会话已删除。报告见`.runtime/multi-question-live.json`，截图为`.runtime/screenshots/multi-live-*.png`。本条为真实模型路径，不与演示E2E混称。

## 边界

一次最多4道明确指定且清晰的题；复杂四题仍可能触及现有120秒/输出上限。当前校验状态属于整组，尚无逐题独立状态或原图自动按题裁切。旧记录归属不明确时保留原布局，不猜测关联。本次不宣称整卷批改、全学科准确率或M0整体安全验收完成。
