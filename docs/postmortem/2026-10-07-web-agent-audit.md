# 网页版多 Agent 复查与修复

日期：2026-10-07。范围：当前共享 RN/Web 源码、隔离 Chromium 和本地 Web 导出；不含 APK 安装或线上部署。

## 结论与问题

按用户要求由布局、设置、Web 平台三路 Agent 只读复查，主 Agent 隔离复现后分路径授权修复，再交叉复核导航。确认并修复7类问题，并收尾1项既有导航尺寸回归；检查严重度是本轮影响分类，不是全项目上线结论。

| 级别 | 触发与原行为 | 修复与关键回归 |
| --- | --- | --- |
| P1 | 非字符串收藏等文档值被当成 I/O，启动中断、健康记录不可用 | 带键损坏分类；附加信息保留至显式确认修复，摘要可重建，真正 I/O 不删数据 |
| P1 | settings 的 JSON/结构/值类型损坏阻挡全应用 | 保留原值、以未配置状态开放题目/导出，提示重新配置；有效保存才覆盖，无自动模型调用 |
| P2 | 独立校验配置未填完，已填好的解题连接测试也失败；反向同样 | 仅测试所选角色及密钥，保存仍完整验证，两角色及零请求拒绝均覆盖 |
| P2 | 100字批名和运行中五项操作超过短横屏高度，关闭按钮被裁掉 | 标题限两行、固定关闭栏、安全区与主题，有界滚动；568×320与320×568逐项确认命中/停止/关闭 |
| P2 | 大图放大后键盘无法读取边缘，方向键改缩放而非平移 | 方向键有界四向平移，加减缩放，0清除平移复位；触摸/鼠标原能力回归 |
| P2 | 最近题目 localStorage 读写失败阻挡恢复、显示或新题解答 | 降为非关键定位缓存，有固定提示，恢复后清除；IndexedDB 与 history 错误不吞 |
| P2 | 刷新后编号重置导致浏览器返回失效 | 版本/实例/页面快照，跨刷新前进后退；清除已删除目标，非当前页刷新只加载题目数据，最近题目标保持一致 |
| P3 | 既有紧凑导航回归测得57px，超过56px上限 | 容器垂直留白4→3px，按钮48px点击区域与字号不变，不放宽断言 |

代码入口为[Settings](../../apps/mobile/src/components/settings.tsx)、[批次](../../apps/mobile/src/components/batch-workspace.tsx)、[大图](../../apps/mobile/src/components/image-viewer.tsx)、[Web 文档](../../apps/mobile/src/local/documents.web.ts)、[共享仓库](../../packages/client/src/local-repository.ts)、[Runtime](../../apps/mobile/src/runtime.ts)、[Web 平台](../../apps/mobile/src/platform.web.ts)及[导航](../../apps/mobile/src/use-workspace-navigation.ts)；尺寸收尾见[底部导航](../../apps/mobile/src/components/app-navigation.tsx)。持久化取舍见[恢复决策](../../.agents/notes/implemented/storage/2026-10-07-browser-recovery-boundaries.md)和[导航决策](../../.agents/notes/implemented/rendering/2026-10-07-browser-history-reload.md)。

## 首次失败与环境

Node24.19.0、pnpm11.7.0；使用既有 corepack pnpm.cjs 路径，未修改依赖或锁文件。测试只使用合成题图、隔离 IndexedDB/localStorage 和 fixture-model.invalid 假模型，无真实请求费用。

自建静态服务 URL `http://127.0.0.1:57417`、PID3567752，交付前关闭；证据保存在私有 `.runtime/web-agent-audit-2026-10-07/`，不提交原日志与题图。

旧 Web 构建桌面复现：导航1失败，角色测试2失败/2通过，布局2失败，存储6失败/1通过；合计11失败/3保护场景通过。适配单元首次1失败/11通过。失败断言保留，未放宽标准。交叉复查纠正了导航旧快照的删除与最近题一致性问题；类型检查中出现 optional 显式 undefined 与重复标识符问题，修正后重新验证。

## 验证

所有 pnpm 命令均通过上述本机 Node/corepack 路径执行，浏览器设置 `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:57417`。

| 实际入口 | 结果与范围 |
| --- | --- |
| `pnpm typecheck`；`pnpm exec tsc --project apps/mobile/tsconfig.json --noEmit` | 退出0；共享/API/测试与移动端类型；新增测试后另跑根 `pnpm exec tsc --noEmit` 退出0 |
| `pnpm build:web` | 退出0，更新本地 `apps/mobile/dist`；没有生成 APK |
| `pnpm exec vitest run --project unit` + 5个定向文件 | 43/43，退出0；browser-navigation、navigation-state、documents.web、local-history、storage-recovery |
| `pnpm exec playwright test` + 5个定向文件 | 34/34，退出0；两种视口的批次操作、大图、浏览器历史、设置角色和存储边界 |
| 浏览器历史 `--grep 'latest current'` | 新增一致性场景2/2，退出0；定向合计18场景×2=36检查，复跑不累计 |

扩大回归包含原 navigation、batch-solving、history-management、storage-recovery、history-recovery、thinking-settings、exam-settings 和 responsive-ui 共27场景×2。首次52通过/2失败（退出1），两项失败同为导航57px超过既有56px上限。修正容器留白后重建 Web，导航/响应式/批次操作20项复测全部通过（退出0），不重复计算已通过场景。最终45场景×2=90项浏览器检查通过；旧失败日志保留。

浅/深主题×568×320/320×568另做4组私有视觉检查：页面无横向溢出，修复入口可见，主页操作滚动后可点击；最终导航高55px。已实际查看批次修复前后及恢复提示浅/深截图。测量不等于Android字体放大验收。

`pnpm lint`、`pnpm docs:check`、`git diff --check` 退出0，包含源码边界与 docs:check；新增2项决策记录，冻结历史文档108份保持。管理脚本未改，未执行 docs:test。

## 限制与后续

本轮浏览器视口不等于 Android。系统字体放大时导航标签高度、SecureStore 旧密钥清理失败后的设置反馈、原生设置反馈重布局滚动，以及更短屏幕裁切空间均未得到真机复现，未按确认缺陷修复。

Firefox/Safari、实际上游 CORS、真实解题准确率、原生存储故障与线上发布未验。Web 内存密钥刷新后仍需重填，不增加云同步或自动任务重放。损坏记录中无法辨认批次归属时保留旧批次目标交给维护，不武断认定其已删除。升级前只有数字的浏览器旧条目无法重建页面。
