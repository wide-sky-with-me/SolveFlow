# 考试平台视觉与动效验收

日期：2026-11-08。

范围：`feat/public-photo-web`本地工作区，学生端、教师端、管理端与共用Web组件。沿用已有字体、蓝色主题及SVG，不改考试数据、模型配置或远程服务。

结论：本地分组回归224个不同用例通过，其中视觉动效专项8项；共用拍题界面另8项通过。计时组在测试代理修复后连续两轮21/21，控制台最终42/42。不作为发布或真机验收。

## 问题与改进

状态标签使用多套旧色值，同类提示与答案颜色不完全一致。统一共用语义调色板，保留明暗/系统主题，状态文字对比度检查4.5以上。主次按钮、焦点、卡片与弹窗阴影统一，关闭与新建使用共用SVG；保留醒目的持久红色提醒。

新增短弹窗、菜单、页面和当前答案入场；主动切换才创建对应视图，轮询不重播，退出与取消不等待动画。系统减少动态效果时关闭动效，图片查看器仅透明度变化。普通表单操作区保持可见，焦点滚动预留空间；四模块窄屏名称两行显示，避免末尾模块编号被截断。

## 验证与证据

证据在忽略目录`.runtime/ui-polish-20261108/`。`before.log`6项失败，复现颜色不一致、缺少入场反馈、表单操作区不可见。新增动效时曾把背景动画重复计数，按真实动画名称修正观察器，保留一次入场断言。文字范围检查继续复现模块名称截断，已改两行。补查保存失败时，`form-error-before.log`8项中的2项复现错误被底部操作区遮住，改用弹窗已有顶部提醒区；`verified-visuals.log`最终8/8通过。

Chrome/WebKit验证三套主题、320/390/1440宽、状态色一致和对比度、模块文本范围、表单底部可见、焦点不被操作区遮挡、Esc焦点恢复、同步不重播、切题入场和减少动态效果。组件截图为合成预览；弹窗采用视口截图，避免全页截图改变原生居中的观察结果。

完整页面首轮核心48/48、控制台40通过/2失败。右下角提醒的位移入场使首帧离底部超过既有24像素约束，取消该提醒的位移动效后42/42通过；最终样式再次42/42，见`direct-core-ui.log`。

学生逐题首轮35通过/2失败：状态色过渡让主题切换首帧仍是旧颜色；移除状态块颜色过渡后37/37通过。保留原颜色断言及按钮、入场反馈。

计时组曾在WebKit不同步骤偶发等待：首次过期提醒超时，随后历史列表停在读取中、教师结束通知未到达。诊断保留在`complete-timing.log`、`timing-diagnostic.log`、`verified-timing.log`，未删断言或增加等待时间。本机存在代理环境，最小回环实验`proxy-probe.log`证实：指定不可用代理时WebKit没有请求抵达本机服务，补充回环绕过后21次请求成功。考试验收脚本合并既有绕过名单后补回环地址，计时连续两轮通过；这支持测试环境代理干扰的判断，不能据此推断生产公网已通过。

定向复测使用`node scripts/test-managed-exams.mjs --image=postgres:17.11-alpine3.23 --suite=<组名>`。下表各定向日志退出0；核心48项来自首轮`--suite=all`通过阶段，该次整体因后续UI失败退出1，不能算作整组成功：

| 分组 | 通过 | 日志 |
| --- | --- | --- |
| 核心 | 48 | `all-regression.log`核心阶段 |
| 控制台/计时 | 42/21 | `direct-core-ui.log`、`direct-timing-1.log`与`direct-timing-2.log` |
| 学生逐题 | 37 | `complete-core-flow.log` |
| 边界/临时练习 | 16/5 | `complete-boundaries.log`、`complete-practice.log` |
| 分配/模型方案 | 8/10 | `verified-allocations.log`、`verified-models.log` |
| 场次管理/答案值 | 22/7 | `verified-management.log`、`verified-answers.log` |
| 视觉动效 | 8 | `verified-visuals.log` |

分组收集检查`collection.log`确认原143项各归属一组，不重复、不漏收；新增视觉组独立8项。拍题客户端共用弹窗专项由原fixture脚本临时限定`delete confirmation|compact controls`执行，Chrome/WebKit各4项通过，见`photo-chromium.log`、`photo-webkit.log`，不冒充完整拍题回归。

实际页面人工查看包含学生答案、教师320px弹窗、场次320px列表、教师消息、控制台桌面明暗和大屏内学生弹窗；合成组件另查看三套主题、表单失败及模块文本。截图归`.runtime/exam-console/screens/`、`.runtime/teacher-layout-20261105/screens/`、`.runtime/exam-upgrade-20261107/screens/`和本次`screens/`；拍题共用弹窗也检查了窄屏深色截图。

`pnpm --filter @solveflow/exam-web build`、`pnpm --filter @solveflow/photo-web build`退出0；`pnpm docs:test`20/20、`pnpm lint`及`git diff --check`退出0。计时重复轮次不重复计入224项；当前构建为Web，不代表APK、原生或发布包。

## 限制

未调用真实模型或生产存储，未替换腾讯云/Mac；未提交、推送或修改账号。WebKit不是iPhone真机，未验收真实虚拟键盘与公网延迟；界面约定归[当前文档](../subsystems/managed-interface.md)。
