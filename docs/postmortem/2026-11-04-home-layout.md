# 看板首页分区与共用图表验收

日期：2026-11-04。

范围：`feat/public-photo-web`工作区中心考试看板首页；Linux Chrome、Playwright WebKit和隔离PostgreSQL 17。浏览器示例仅注入合成快照，未写入现有考试数据，未调用真实模型。

## 变更与处理

首页原先将六项计数、异常横条和图表顺次堆叠。现在用四项摘要、主进度/异常入口、趋势/状态图、模块/学生明细分区，答案和异常数量各自集中展示。环形进度移入[共用图表](../../apps/exam-web/src/browser/charts.tsx)，与[大屏](2026-11-04-wall-layout.md)使用同一覆盖率计算、零值处理和动效；不新增依赖。场次范围、五秒轮询、取消/去重刷新和原有详情权限未变。当前语义见[控制台说明](../subsystems/managed-exam-dashboard.md)。

首轮手机截图发现原因卡片未铺满：平板网格的`align-items:start`在手机切为flex后仍生效。手机恢复stretch，保留至少44像素的操作入口。原因计数全为零时使用至少1的条图分母，避免无效宽度。第二轮交互发现WebKit的图表内容溢出并拦截学生“查看”按钮；将图表卡片设为明确高度，允许flex子区域收缩并限制溢出，保留普通点击校验，新增内容边界断言。

## 验证结果

- `pnpm --filter @solveflow/exam-web build`退出0，更新本机静态产物。
- 新增两项双引擎回归，覆盖问题总入口、具体原因筛选、学生详情回调、图表切换、减少动效、长姓名/模块、320/390/768/1280像素及零数据。
- 首轮定向2项失败：测试将原因按钮的无障碍名称写成无空格，实际名称含空格，点击等待超时。核对浏览器无障碍树后修正精确名称，保留原因回调的严格断言。原始日志为`.runtime/home-redesign/target.log`。
- 修正选择器后首轮复测Chrome通过、WebKit失败，日志为`.runtime/home-redesign/target-final.log`；页面图表拦截了学生按钮点击，按上述容器边界修复。
- 图表边界修正后定向复测退出0，2/2通过、56项跳过，16.28秒；新增场景不与失败重跑累计。日志为`.runtime/home-redesign/target-layout-final.log`。
- `pnpm exec tsc --noEmit`、`pnpm lint`、`git diff --check`均退出0；最终构建退出0，20张双引擎截图检查未见页面横向溢出或脚本异常，统计页和大屏包含在复查内。
- `PLAYWRIGHT_BROWSERS_PATH=.runtime/playwright node scripts/test-managed-exams.mjs --image=postgres:17.9-alpine3.23`退出0，58/58通过，140.96秒，含原有刷新去重、全屏详情、权限、任务与教师/学生流程。日志为`.runtime/home-redesign/regression.log`，临时数据库由运行器清理。

截图入口`.runtime/home-redesign/index.html`，每引擎10个状态：实际/合成数据的浅深主题、三种窄屏、空数据、统计页和大屏。多学生示例不代表生产负载。截图与结构检查分开保存，手机视口不等于真机验收。本机健康检查和页面均200，匿名管理请求仍401；对照图7张引用均成功加载。

## 未验证项与剩余风险

未部署Mac或公网，未提交代码；现有工作区改动、预览账号和考试数据保留。此次不验真实模型、相机、iOS/Android真机或长时负载；学生明细窄屏保留卡片内横向滚动。
