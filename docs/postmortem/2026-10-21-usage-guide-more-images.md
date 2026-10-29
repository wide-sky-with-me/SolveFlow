# 使用说明操作配图扩充验收

日期：2026-10-21，Asia/Shanghai。范围：沿用已有未提交改动，仅扩充应用内说明配图，不提交、推送或调用真实模型。

## 变更

[说明](../../apps/mobile/src/components/usage-guide.tsx)新增6张[操作截图](../../apps/mobile/src/components/usage-guide-screens.web.tsx)，覆盖拍题入口、裁切确认、批量排序、同题补图、历史搜索及完整备份；保留原3张PDF配图，Web的8个章节均有图。截图只在Web展示，沿用既有比例容器与固定返回栏。

新增图片539744字节，全部使用隔离浏览器、8条合成记录及自行绘制的练习题图，不含用户记录、凭据或真实模型原文。采集经过相册选择、预览排序和保存补图等实际界面，POST、模型请求与页面异常均为0。未确认批量导入、重新解答或实际备份下载。图片来源与用途见[资源说明](../../apps/mobile/assets/help/README.md)。

## 验证

Node24.19.0、pnpm11.7.0；本轮服务`http://127.0.0.1:46399`，PID3785880。证据位于`.runtime/usage-guide-more-2026-10-21/`。

| 实际命令或范围 | 结果 |
| --- | --- |
| `CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/usage-guide-more-2026-10-21/web` | 退出0 |
| `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` | 均退出0 |
| `CI=1 SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:46399 pnpm exec playwright test tests/mobile-e2e/usage-guide.spec.ts --reporter=line --output=.runtime/usage-guide-more-2026-10-21/browser-results` | 桌面/移动2项通过，退出0 |
| `pnpm lint`、`git diff --check` | 均退出0 |

扩充前先在旧构建复现仅3张配图、不满足9图及分节要求，退出1，保留before.log。人工核对全部新增截图；裁切页改用390×650视口减少空白，其他截图沿控件边界截取。

最终覆盖9图加载、章节归属、显示比例、深浅色、320px窄屏无横向溢出、固定返回、底部关闭及键盘开关。浏览说明POST与模型请求为0。未执行原生包、真机或真实模型验证。

## 本地交付

已同步至现有`http://127.0.0.1:3100`：备份原入口后原子切换，首页、12项入口资源及13项新增资源均返回200。未重启服务或操作用户历史，现有标签页刷新生效；资源及哈希见publication.json。

46399测试服务已停止，原PID不存在、端口关闭；3100仍返回200，见cleanup.json。
