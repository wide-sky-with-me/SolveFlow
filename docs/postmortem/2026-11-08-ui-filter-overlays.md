# 组合筛选、提醒层级与窄屏界面巡查

日期：2026-11-08。

范围：`feat/public-photo-web`、`ee17fcb`之后的本地工作区，保留原有教师面板改动；隔离PostgreSQL、合成账号/图片与假模型，Chrome及WebKit浏览器。未提交、推送或部署。

## 问题与修复

- 后台组合筛选逐项触发结果请求。统一暂存搜索与筛选，提示待应用条件数；查询一次提交并回第一页，重置恢复入口默认范围。原结果、轮询和手动刷新继续使用已应用条件。覆盖用户、进度、分配、模板、场次、参与人员和待处理队列；学生快捷分类及选择器内搜索保留原方式。
- 教师提醒展开后，固定页尾空间不足，覆盖分页及末行；分页菜单还会被红色提醒拦截点击。改为测量实际提醒高度预留滚动空间，菜单位于提醒上层，弹窗暂时隐藏提醒时保留空间。
- 分页和搜索按钮点击区域不一致，人员多选收起后长名单难辨认数量。统一至少44像素目标，多选超过一人显示人数与上限，展开保留完整选中项。
- 服务配置在320像素视口下角色按钮换行，底部按钮文字被拆开。角色保持三列，保存配置独占底部一行，辅助动作并排。

当前行为归[列表](../subsystems/managed-exam-lists.md)、[提醒](../subsystems/managed-exam-attention.md)及[界面](../subsystems/managed-interface.md)，教师面板前一轮证据保留在[独立报告](2026-11-08-teacher-workspace-tabs.md)。

## 验证记录

证据位于忽略目录`.runtime/ui-audit-20261108/`；`baseline.json`及`baseline.patch`保存开工前改动。日志保留失败与复测，不把重复运行累计为新场景。

首次补充的4个浏览器回归全部复现：编辑条件已发出请求，展开提醒盖住页尾。首轮修复后2项通过、2项暴露分页菜单层级问题，修正后通过。全量管理回归一度27通过、1失败，原因是合成用户超过第一页，测试误认管理员始终可见；改为核对查询前后完整原页内容，未降低查询次数、条件及重置断言。

静默刷新组首次38通过、4失败：2项直接组件夹具未传新增空间回调；2项发现草稿期间刷新被禁用。夹具按真实管理页接入高度，恢复刷新已应用条件的能力，6项定向复测通过。首次类型构建发现新增代码的字典类型及浏览器上下文调用错误，修正后构建通过。

最终去重为128项通过：管理28、分页/教师/控制台42、学生流程37、服务方案10、视觉8、真实浏览器流程及空队列恢复3。定向复测属于上述场景，不额外累加。具体命令：

- `pnpm --filter @solveflow/exam-web build`：退出0，日志`build-complete.log`。
- `node scripts/test-managed-exams.mjs --image=postgres:17.11-alpine3.23 --suite=core-ui`：初次退出1；修复后的6项定向检查退出0，覆盖4项失败及2项相邻刷新场景。
- 同一入口`--suite=core-flow`：37项，退出0，`core-flow.log`。
- 隔离PG环境内执行`pnpm exec vitest run --reporter=verbose --config vitest.integration.config.ts`，分别选择`apps/exam-web/src/server/`下的`exam-management.integration.test.ts`、`model-services.integration.test.ts`、`ui-polish.integration.test.ts`，`-t '.'`：28/10/8项通过，退出0。服务配置最终窄屏样式另以`-t 'keeps student choice'`复测2项，退出0。
- 同一Vitest入口选择`managed.integration.test.ts`，`-t 'runs the real mobile browser flow|empty final issue page'`：3项，退出0；新增管理UI6项强化验证也退出0。记录见`workflow-extra.log`、`ui-final.log`。

`verification-counts.json`保留去重来源。`pnpm lint`及`git diff --check`退出0；边界检查通过，文档检查覆盖544篇当前文档、168份决策、318个源码锚点和108份冻结文档。测试容器均已清理。

## 验收边界

页面巡检覆盖看板、跟踪、队列、用户、考试安排与角色权限，1440/390/320像素及明暗主题；原生表单、模型方案弹窗、答案与图片交互另跑所属回归。人工查看了待应用条件、提醒展开、手机跟踪、场次列表及服务配置截图。

浏览器WebKit与移动视口不能代表iPhone真机；未做真实模型调用、联网图片性能或远端发布验收。线上数据、账号、密钥及运行服务均未改动。
