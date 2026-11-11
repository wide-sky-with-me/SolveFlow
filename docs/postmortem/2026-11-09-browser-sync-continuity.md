# 考试页面同步与阅读连续性验收

日期：2026-11-09。

范围：`feat/public-photo-web`，本地 Chrome/WebKit、合成考试及假网络响应；继承此前未提交的界面和后端优化，未部署。

结论：新增12例、原有8例视觉及95例业务/边界回归通过，共115例。浏览器内减少重复读取和公式解析，不代表真实iPhone或上游解题耗时达标。

## 变更与处理

- 首次快照与WS连接原先触发两次读取；现在首次订阅使用已知序号，只在通知仍未被响应覆盖时补读。显式保存后的刷新加入同一串行读取，保证读取发生在提交后；持续新事件不阻止已完成保存恢复按钮。
- 页面隐藏后暂停列表和考试自动快照，考试WS心跳保留；回到页面或恢复网络时静默补查，同期触发合并。手动操作不受隐藏状态限制；不重放模型请求。
- 教师详情原先随全场序号更新重新读取；现在等待首份快照，再依据选中题的内容变化读取。其他题的变化不打断当前题，教师草稿和原DOM保留。
- 未变化的文本复用已渲染结果。每个引擎中，同一公式经8次无关状态更新，KaTeX解析由9次减至1次；更换答案后解析增至2次，内容同步更新。这是单个公式的调用次数，不是整机帧率或耗时测量。

## 验证结果

证据位于忽略目录`.runtime/interaction-smoothness-20261109/`；`baseline/`保存开始前48份已有改动，未清理用户工作区。

`before-final.log`：修正夹具后，Chrome/WebKit共8例复现失败、2例通知竞态保护通过。最初两轮夹具因必填字段、KaTeX依赖定位出错，日志保留，不能算产品缺陷。

`after-1.log`：教师新增答案夹具错误地同时标记人工确认和AI核验，遭契约拒绝；修正夹具，未放宽契约或超时。`after-2.log`：10例通过。

`visual-sync-all.log`：`pnpm exec vitest run --reporter=verbose --config vitest.integration.config.ts apps/exam-web/src/server/ui-polish.integration.test.ts`退出0，20例通过。新增12例覆盖延后建立WS、未覆盖通知补查、保存时旧快照/持续通知、隐藏与返回、旧考试迟到、HTTP失败恢复、教师草稿及公式复用；原8例覆盖明暗主题、窄屏、焦点、长表单和减少动效。

`build.log`：`pnpm --filter @solveflow/exam-web build`退出0，包含TypeScript检查及浏览器/服务端构建。

隔离PG17.11、合成图与假模型的标准回归命令为`node scripts/test-managed-exams.mjs --image=postgres:17.11-alpine3.23 --suite=<分组>`，依次运行，均退出0：

| 分组 | 数量 | 日志 |
| --- | --- | --- |
| `core-ui` | 42 | `core-ui.log` |
| `core-flow` | 37 | `core-flow-final.log` |
| `boundaries` | 16 | `boundaries.log` |

`core-flow.log`首次36过1失败：异步切题后通用答案选择器仍可能指向旧题，节点移除时样式为空。回归改为等待“第6题答案”区域后检查原有颜色标准，整组37例通过，未改变样式或放宽断言。`lint.log`曾因答案文档超长8单位失败，精简后`lint-final.log`退出0。最终文档检查与差异检查以`checks-final.log`为准；未放宽长度政策。测试容器均在各组结束后移除。

## 未验证项与剩余风险

未访问腾讯云、远程Mac、真实模型或私有对象桶；未改账号、密码及线上服务。真机拍照、iOS后台冻结与低内存、蜂窝网络、COS往返和真实解题速度仍需独立验收。后台期间的教师提醒在返回页面后补齐。行为和取舍分别归[平台说明](../subsystems/managed-exams.md#任务与同步)与[同步决策](../../.agents/notes/implemented/architecture/2026-11-09-browser-sync-continuity.md)。
