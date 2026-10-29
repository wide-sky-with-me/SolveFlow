# 补图提示真实计时复核与关闭入口

日期：2026-10-27。范围：本机Web补图成功提示，不含远程部署。

## 复核结论

用户确认问题发生在本机3100。服务实际提供的构建已含5秒定时，与源码一致；上轮使用模拟时钟验证。本轮隔离浏览器改用真实计时，已有构建能自动移除提示，没有复现用户标签页中的“始终不消失”。无法读取该Windows标签页实际加载的脚本或主线程状态，因此没有把原因确定为缓存、计时器失效或任务更新。

旧构建用例先通过真实过期断言，随后因尚无本轮新增的“关闭提示”按钮而超时；该失败不算计时问题复现，原日志保留。

## 改动

[批次页面](../../apps/mobile/src/components/batch-workspace.tsx)在回执产生时写入固定截止时间，不以effect执行时间作为起点。到期隐藏并清除；恢复前台重新检查，渲染时也不显示过期回执。新回执保持独立期限，旧计时不清除较新的回执；切页及卸载释放计时与订阅。

[通用提示](../../apps/mobile/src/components/ui.tsx)新增可选关闭回调，仅补图成功回执启用右侧×，保留键盘焦点和可访问名称。关闭回执不取消任务，错误及其他原有提示没有自动隐藏策略变化。当前语义见[批量补图](../subsystems/batch-materials.md)。

已打开页面不会因为服务静态资源更新而替换正在执行的脚本，需要用户刷新；不强制重载可能正在答题的标签页，新版本可通过提示右侧×确认。

## 实际验证

Node24.19.0、pnpm11.7.0、Chrome。45196隔离端口禁止真实模型，使用合成JPEG、独立IndexedDB和假模型。

- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`：均退出0。
- `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/material-notice-expiry-2026-10-27/web`：退出0。
- `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45196 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-materials.spec.ts --output .runtime/material-notice-expiry-2026-10-27/browser-full`：53通过、3项鼠标专用场景在触屏配置跳过，退出0，2.6分钟。

新增场景不用Playwright时钟、强制状态更新或阻塞sleep；实际保存并重答后等待DOM移除，在8秒观察窗口内确认消失，再提交第二条同文案回执、手动关闭，验证两题各重答及校验一次。既有模拟时钟场景继续验证提示消失时后台任务不取消。真实采样时间另存`real-time-expiry.json`，包含轮询间隔，不能当成精确计时器触发时刻。

`pnpm lint`退出0，包含源码边界与文档检查。私有证据与修改前源码在`.runtime/material-notice-expiry-2026-10-27/`；原生真机及用户Windows标签页状态未验，没有真实模型调用。

本机3100服务261661保留，29项构建文件先复制资源再原子替换入口；首页与11项JS/CSS均200且哈希匹配。旧版复核与新版验证的45196自建进程均核对并停止，远程Mac未部署。
