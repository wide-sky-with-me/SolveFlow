# 题目整理提前取消与错误分类

日期：2026-10-14。范围：Web 导出弹窗的取消入口及排版模型错误分类，不改变题库、模型配置、请求次数或既有时间上限。

## 现场证据与结论边界

用户 Windows Chrome 截图显示“导出已取消”，27 题仍待整理。原 Mac 应用日志在 `2026-10-14T07:41:13.953Z` 记录 solver 请求 `client_disconnect`、上游 HTTP 200、首字节约 1.99 秒、接收 415404 字节、总计 15063 毫秒。这证明请求已发出且由客户端侧断开，不证明用户按过 Esc，也不证明 Windows 特有故障、供应商格式错误或模型精度问题。

实际 launchd 运行恢复网关，它导入的 `gateway-base.mjs` 摘要为 `0517c6766c83d8db83b02feb842ec0fa63c9ca835a21c114e081aa7ad10d6882`。该副本仍使用设备阶段上限加余量的模型转发时限；15 秒配置是接收请求的 HTTP requestTimeout，见 [Node 24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.json)，不据此认定响应阶段在 15 秒超时。没有修改网关、证书或恢复包装器。

## 可复现缺陷与修正

原 HTTPS 来源的隔离 Chromium 回归用模拟模型暂停首题。虚拟时钟前进 17 秒，整理仍工作；随后按 Esc，状态立即由 working 变为 pending，出现同类取消提示。失败断言在 [浏览器回归](../../tests/mobile-e2e/paper-preparation.spec.ts) 的忙碌状态检查，证据保留在 `.runtime/print-cancel-2026-10-14/before`。

[导出入口](../../apps/mobile/src/components/batch-pdf-export.web.tsx)原先禁用关闭按钮，却仍将忙碌时的 Esc 直接转为 abort。修正为忙碌时忽略快捷关闭，只保留显式取消按钮；空闲时 Esc 仍可关闭。取消不再由[任务 hook](../../apps/mobile/src/components/use-batch-pdf-export.web.ts)渲染为失败红条，真正错误仍保留红色反馈。

[模型适配](../../packages/agent/src/pi/batch-print-layout.ts)在 SDK prompt 抛错时原先跳过截止及取消归因，直接泄漏取消码。新增失败回归模拟截止时刻 SDK 抛 CANCELLED，原实现失败；修正优先判断调用方取消、阶段截止和已知传输错误，finally 仍清理资源。没有延长截止或增加自动重试。

## 验证与发布

`pnpm exec vitest run packages/agent/src/pi/batch-print-layout.test.ts apps/mobile/src/runtime.test.ts apps/mobile/src/local/prepare-paper-batch.test.ts --maxWorkers=2`：36 项通过。Web 构建、移动端及根类型检查退出 0。阻断上游的离线 Web 服务运行背景导出、PDF 变体和持久整理三组 E2E，56 项通过；其中新场景覆盖慢请求完成、Esc 不误取消、显式取消、截止报超时、断连报连接失败、迟到响应无效和历史未改。最初文档检查因子系统文档 2229 单位超出 2200 失败，精简后 lint 与 diff 检查通过。

Mac 已切到 `20261014-print-cancel-1610`，升级前连接数 0。备份目录 `shared/backups/20261014-before-print-cancel`，前版目录/镜像保留；模型设置、预设、TLS、launchd 及恢复网关两文件摘要一致，其他项目容器 `396f62b26017` 未变。归档摘要 `b486c74d27f98db1a326874ff1dd7e6b4405cd42e5a3e2eaf906779c7592eb16`；Web index 摘要 `667e65fd3c118a6d1bb58520e9e466d5bf8262817b8b6b5d2c7d1cd18044b3b6`，服务器产物未变。

原 `https://192.168.100.84:3130/` 来源使用私有 Playwright 配置，顶部入口与新取消场景十项、空闲 Esc 关闭两项均通过。模型响应均在隔离浏览器拦截；首页 HTTP 200，应用容器健康，升级后日志只有 ready，没有真实模型调用。证据目录 `.runtime/print-cancel-2026-10-14/mac-e2e` 与 `mac-idle-after`。这是已复现取消路径及分类错误的修复，不宣称已确认用户现场的具体取消来源。

本次未重跑用户题图的真实付费模型。Windows 实际浏览器的按键/取消来源没有被采集；隔离 Chromium 和虚拟时钟回归不等同于该 Windows 配置的端到端真实整理验收。此前验收范围见[顶部入口](2026-10-14-pdf-preparation-header.md)，当前规则见[批次 PDF](../subsystems/batch-pdf.md)。
