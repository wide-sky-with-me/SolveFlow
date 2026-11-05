# 浏览器生命周期与视觉边界的深度复查

日期：2026-11-03。

范围：`feat/public-photo-web` 当前工作区，公网单题及中心平台；合成题、假模型、隔离 PostgreSQL、Chrome 与 Playwright WebKit。未提交、推送或部署，真实付费调用 0 次。

## 复现与修正

| 问题 | 原本影响 | 修正 |
| --- | --- | --- |
| 断网停止等待服务器确认 | 已接受任务停止后“拍下一题”持续禁用 | 先持久本地取消，保留服务器同步标记；恢复网络后只补取消。待同步提示仅在未确认时显示，不阻塞下一题 |
| 多个取消同步同时收尾 | 后到的失败可能重新挂起已确认状态 | 同一标记合并进行中同步，成功后统一移除；双击停止与迟到失败有回归 |
| 学生详情请求乱序 | 先发的第1题响应覆盖已打开的第2题，也可能重开已关弹窗 | 新查看、关闭和卸载中止旧请求，并检查请求身份；背景同步只更新仍打开的同题。教师详情也检查取消信号 |
| 下拉列表没有定位当前选项 | 40项列表选中末项，打开仍停在顶部 | 焦点与滚动同步，Tab继续后续表单，Esc回触发按钮；保留原主题，检查手机深浅色 |
| 页面信号替代请求超时 | 生命周期未取消时，挂起请求可一直阻塞后续同步 | 页面取消与原50秒期限共同生效，完成后释放监听/计时器；不自动重发写入或模型请求 |
| 测试服务元数据被清除 | Playwright启动清空输出目录，同时删掉原PID/URL记录 | 元数据改放输出目录旁，便于核对所属测试服务及清理 |

取消仍不能保证断网时立即停止远端模型，后台可能已完成或继续计费；没有将本地停止包装成服务器确认。标记仍有20项上限，服务器并发/额度照常执行。长期原因见[浏览器生命周期决定](../../.agents/notes/implemented/architecture/2026-11-03-browser-intent-lifecycle.md)。

当前语义归[公网指南](../cookbook/public-photo-web.md#任务与连接恢复)、[中心平台](../subsystems/managed-exams.md)及[共用界面](../../packages/web-ui/README.md)。

## 验证与证据

新增失败回归先于修复运行：公网离线停止4例均因下一题禁用失败；中心2例分别证明当前选项不可见、标题从第2题被改回第1题。修复后定向4/4与2/2通过。

请求期限单元以虚拟时间推进50秒，证明页面信号存在时请求仍不结束；修复后2/2通过，包括主动取消和无额外派发。初稿另一断言在abort前读取reason得到undefined，已改为显式固定取消原因后重新执行基线，保留首次日志，不将这项测试错误计为产品缺陷。

| 检查 | 本轮结果 |
| --- | --- |
| `pnpm --filter @solveflow/photo-web build`、`pnpm --filter @solveflow/exam-web build` | 构建通过；中心平台在完整回归前另构建请求期限修正 |
| `pnpm exec vitest run --project unit apps/exam-web/src/browser/api.test.ts --maxWorkers=1` | 2/2，退出0，0.19秒；只用fetch夹具/虚拟时间 |
| `node scripts/test-photo-web.mjs` | Chrome 32/32，退出0，约1.6分钟 |
| 同上，设置 `SOLVEFLOW_PHOTO_TEST_ENGINE=webkit`、`PLAYWRIGHT_BROWSERS_PATH=.runtime/playwright` | WebKit 32/32，退出0，约1.8分钟；同组场景单列，不累计为不同功能样本 |
| `node scripts/test-managed-exams.mjs --image=postgres:17-alpine` | 隔离集成与Chrome浏览器53/53，退出0，115.51秒 |
| 类型、源码边界、`pnpm docs:check`、`git diff --check` | 均退出0；未放宽长度，超限的状态页已精简 |
| `pnpm docs:test` | 管理回归20/20，退出0 |

原失败、定向及完整日志在 `.runtime/deep-review/`，完整成绩分别为 `photo-chrome-final.log`、`photo-webkit-final.log`、`exam-final.log`。中心新用例由实际组件构建，快照来自隔离数据库，受控延迟/列表响应用浏览器路由；不代表真实网络负载。截图按 `before/` 与 `screens/` 区分，对照页为 `gallery/index.html`。已人工查看长列表前后、详情标题前后和手机离线停止页。

深色初图截在主题过渡中，未用作稳定配色结论；重拍禁用截图动画，并增加当前选项/触发器文字对比度断言，新增断言后定向2/2通过，见 `visual-final.log`。两控件稳定状态均满足 [W3C 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) 的4.5:1阈值，不代表整站无障碍认证。

已有本机3190健康检查200、前端入口与最新构建一致，匿名会话401；两次公网完整测试的旁置PID记录均可读取，进程已退出。本轮没有重启已有服务或变动其数据库。

## 未验证项与剩余风险

上一轮单次 WebKit 重试提示超时的原因仍未查明，本轮修正不能作为其根因证明。未进行真实iPhone相机、软件键盘、低内存、真实模型或持续多人压测；无新依赖或数据库迁移。已有本机服务及用户数据保留，公网和远程Mac未更新。

后续[时序调查](2026-11-03-photo-timeout-investigation.md)证实同症状可由迟到本地读取引起，另保留原首次现场的证据边界。
