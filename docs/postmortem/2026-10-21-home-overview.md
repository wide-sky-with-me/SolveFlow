# 首页空间与最近记录验收

日期：2026-10-21，Asia/Shanghai。范围：已有未提交改动上的首页布局与入口，不提交、推送或调用真实模型。

## 变更

原桌面首页只有约280px高的拍题卡片，剩余区域空白。[页面](../../apps/mobile/src/workspace/pages.tsx)在没有当前题图时增加[最近记录](../../apps/mobile/src/components/recent-records.tsx)：按保存时间取最近4项，同一批次合并计数，点击打开原单题或批次；“查看全部”清除搜索后进入历史。复用已有摘要，不额外读取题图或请求模型。

[桌面样式](../../apps/mobile/src/workspace/desktop.web.css)让拍题区填充余高，放大原生绘制的插图、标题和按钮，最近记录双列排列；窄屏保留原拍题布局并改为单列记录。没有历史时不展示占位记录。使用说明与[当前文档](../subsystems/rendering.md)同步更新，无新增依赖或持久化字段。

## 验证

Node24.19.0、pnpm11.7.0；独立服务`http://127.0.0.1:45193`，PID3697419。桌面与移动浏览器，最大1920×1080、最窄320×700，短横屏568×320/844×390，深浅色、减少动态效果。新增用例使用6条合成记录；其他相关场景沿用fake模型。证据位于`.runtime/home-overview-2026-10-21/`。

| 实际命令或范围 | 结果 |
| --- | --- |
| `CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/home-overview-2026-10-21/web` | 最终退出0 |
| `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` | 均退出0 |
| `CI=1 SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45193 pnpm exec playwright test tests/mobile-e2e/home-overview.spec.ts tests/mobile-e2e/desktop-layout.spec.ts tests/mobile-e2e/responsive-ui.spec.ts --grep 'empty home fills\|home recent records\|desktop home keeps\|wide home keeps\|resizing a wide answer\|short landscape keeps photo\|desktop navigation and materials' --reporter=line --output=.runtime/home-overview-2026-10-21/browser-final-results` | 14项通过，退出0 |
| `pnpm lint`、`git diff --check` | 最终均退出0 |

新布局断言先在旧构建复现拍题区域占用不足，退出1，保留before.log和截图；初轮改版4项通过，最终14项包含这4项，不重复累计。覆盖已配置/未配置模型、批次去重、4项上限、状态、键盘打开、返回、全部历史、相册选图与题页草稿保持。新增首页场景POST为0，未读写用户浏览器数据。

未执行APK、原生包、真机或真实模型验证；浏览器移动视口不代表原生验收。

文档检查首轮因rendering.md超长失败；精简本轮说明后通过，未修改长度门槛，前后日志均保留。

## 本地交付

已同步至现有`http://127.0.0.1:3100`：备份原入口，复制8项新哈希资源后原子切换；首页、12项入口资源及全部新增资源返回200，未重启服务或读写用户历史。现有标签页刷新生效；资源及哈希见publication.json。

45193测试服务已停止，原PID不存在、端口关闭；3100仍返回200，见cleanup.json。
