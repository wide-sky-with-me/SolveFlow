# 公网拍题与中心考试的功能、视觉验收

日期：2026-11-03。

范围：`feat/public-photo-web` 当前工作区。公网版在 Linux Chrome、Playwright WebKit 使用隔离本机服务；中心平台为 Chrome、隔离 PostgreSQL 与假模型。覆盖手机/桌面视口及深浅色；仅使用合成题图，付费请求为 0。

结论：中心考试 51 项流程回归通过；公网版两个浏览器各 26 项完整回归通过。修复弹窗键盘、删除焦点、重答隐藏旧答案、首次失败隐藏原图及窄屏菜单越界。另有一次 WebKit 重试提示超时尚未复现，不能据此宣称所有边界无问题。

## 变更与处理

| 原问题 | 修正及验证 |
| --- | --- |
| 公网删除确认使用普通遮罩，焦点可能跑到背景，Esc 不关闭 | 与中心平台共用原生 `dialog`；限制背景交互，支持 Esc 和焦点返回。删除默认聚焦“保留” |
| 删除最后一条历史后，原按钮已移除，焦点没有落点；快速点击可重复进入删除 | 删除前加同步互斥，禁用提交；移除列表行后关闭弹窗，焦点回历史标签 |
| 重答失败后只剩错误，原来成功的答案不再展示 | 保留最近成功答案，明确标为“上次答案”；本次失败在前，原图仍可展开，不伪装为本次核验通过 |
| 首次解题失败，没有识别结果时原图入口也消失 | 原图入口独立于识别结果，失败后仍可查看照片；刷新历史和重试沿用同一题目 |
| 公网错误要求用户检查并未开放的模型设置 | 服务不可用提示稍后重试，额度不足提示联系管理员，不暴露内部配置 |
| 手机退出、删除和关闭按钮较小；扩大后 320px 菜单左侧越界 5px | 相应触摸区域扩大到 44px，修正菜单可用宽度；保留原越界断言，检查横屏和小高度弹窗 |
| 弹窗和页面滚动策略分散 | 主题统一稳定滚动条占位和弹窗背景锁定，沿用原配色、图标及文字层级 |

实现入口：[公网工作区](../../apps/photo-web/src/browser/main.tsx)、[样式](../../apps/photo-web/src/browser/styles.css)、[共用弹窗](../../packages/web-ui/src/dialog.tsx)。当前使用说明归[公网版说明](../../apps/photo-web/README.md)及[共用界面说明](../../packages/web-ui/README.md)。

## 验证结果

### 实际操作范围

- 公网：错误密钥、身份历史隔离、考试快照、上传与原图、缺选项、重答失败、停止、刷新、断网恢复、保存失败重试、删除和重复点击。确认刷新、恢复与保存重试不会重新派发解题。
- 学生：拍题、补图、自由跳题/模块、状态总览、持续红色问题、断线兜底、教师解决通知和题目定位。
- 教师/管理：AI 答题、手动单/多选、人工确认、处理队列、角色隔离、实时跟踪、看板/统计及数据大屏。此处 AI 路径由假模型驱动。
- 截图查看：桌面看板、大屏、宽教师弹窗、手机深色表单、学生红色问题与解决通知、公网失败页及小高度删除确认。保留按需详情，不新增常驻说明小字。

### 命令与证据

以下均在当前工作区执行，构建不代表安装或部署。

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @solveflow/photo-web build` | 退出 0，包含浏览器和固定用途服务 |
| `pnpm --filter @solveflow/exam-web build` | 退出 0 |
| `node scripts/test-photo-web.mjs` | Chrome 最终完整回归 26/26，约 1.5 分钟，退出 0 |
| 同上，设置 `SOLVEFLOW_PHOTO_TEST_ENGINE=webkit`、`PLAYWRIGHT_BROWSERS_PATH=.runtime/playwright` | WebKit 最终完整回归 26/26，约 1.6 分钟，退出 0 |
| `node scripts/test-managed-exams.mjs --image=postgres:17-alpine` | 51/51，115.15 秒，退出 0 |
| `pnpm exec tsc --noEmit`、两个 Web 应用的 `typecheck`、`node scripts/check-boundaries.mjs`、`git diff --check` | 均退出 0 |
| `pnpm docs:check` | 退出 0 |

初次新增回归为 20 通过、4 失败，分别覆盖两个视口的弹窗键盘与旧答案保留；窄屏菜单及最后一条删除焦点也曾明确失败，修复后保持断言复测。早期同名日志混写，不作为最终凭据。最终日志在 `.runtime/functional-visual/` 的 `photo-chrome-final-source.log`、`photo-webkit-final-source.log`、`exam-after.log`。

随后补测首次解题失败，Chrome 两个视口均因缺少“查看题目”入口失败，证据为 `initial-failure-before.log`。没有改为跳过失败场景，修复原图展示后再跑完整回归。

错误文案定向检查曾出现 Chrome 2/2、WebKit 1/2：桌面一次未在 5 秒内出现失败提示，截图仍显示识别中。随后 WebKit 桌面同场景连续 5 次和最终完整回归均通过。失败日志为 `wording-webkit.log`，保留截图并新增脱敏请求时间线附件；尚未确认原因，未放宽超时或重放请求。重复不累计为新场景。

截图总览及修复前后对照放在忽略目录 `.runtime/functional-visual/gallery/index.html`；原图、测试日志不进入 Git。

## 视觉依据

弹窗焦点、Esc、背景隔离及删除安全动作参考 [W3C Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)。点击目标参考 [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)：该条最低要求为 24px 且有例外，本项目此次选择 44px。失败信息靠近结果、明确恢复方式并保留用户成果，参考 [NN/G 错误提示指南](https://www.nngroup.com/articles/error-message-guidelines/)；层级和间距参考 [NN/G 视觉原则](https://www.nngroup.com/articles/good-visual-design/)。本轮没有进行完整无障碍认证。

## 未验证项与剩余风险

一次 WebKit 超时仍需借助请求时间线复现。Linux WebKit 和移动视口不能代替 iPhone 真机，真实相机、软件键盘、低内存及系统后台限制未验。本轮不评估真题识别、答案正确率、真实模型延迟或持续多用户容量；未提交、推送或更新公网和远程 Mac。

后续[时序调查](2026-11-03-photo-timeout-investigation.md)稳定复现并修复同症状的视图回退；原首次现场缺少时间线，未回填其唯一原因。
