# 超长题自动续页验收

日期：2026-10-21，Asia/Shanghai。基线为main `4f7f8d7`及既有未提交改动。用户允许长题占多页，要求减少手工调整；本轮只改Web打印/PDF排版，不新增模型请求，不提交或推送。

## 变更

[续页器](../../apps/mobile/src/local/paginate-question-pages.web.ts)复用原有缩图/缩排，最低8pt仍放不下时自动增加A4续页，保留原题号、全文、公式、图示与作答。短块尽量完整移动，长段落按整行拆分，续表重复表头且不重复数据行。打印和下载共用该过程；后台导出复用同一PDF构建入口。

[打印帧](../../apps/mobile/src/local/print-batch.web.ts)仅接入当前题，在独立DOM中分页；未来题目仍按原归属冻结，不改历史或整理缓存。[PDF](../../apps/mobile/src/local/download-batch-pdfs.web.ts)随后续题接入刷新物理页清单，保持克隆尺寸检查、取消与资源清理。当前行为见[分页说明](../subsystems/print-pagination.md)，原因见[决定](../../.agents/notes/implemented/storage/2026-10-21-question-continuation-pages.md)。

## 环境与复现

Node24.19.0、pnpm11.7.0；合成题图、fake模型、隔离IndexedDB。测试静态服务`http://127.0.0.1:45383`，PID1737293，不加载环境模型桥接。日志和实际PDF在`.runtime/pdf-auto-pages-2026-10-21/`。

- before.log：旧Web对同一合法长题的桌面/窄屏回归均失败，2项失败、退出1；打印未发生，原单页容量错误阻断导出。
- reading-before.log：兼容检查发现“原始记录”没有单题页壳时遗漏数学适配，新增回归失败、退出1；随后恢复整文档适配，保留断言。
- continuation.log、edge.log：早期长题2项、长表格/取消4项分别通过、退出0；最终复测包含这些场景，不累计计数。

## 最终验证

- `pnpm exec vitest run --project unit --maxWorkers=2`：最终119文件、1466项通过，退出0，见unit-delivery.log。
- `CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/pdf-auto-pages-2026-10-21/web`：最终退出0，见build-final-delivery.log。
- `CI=1 SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45383 pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts tests/mobile-e2e/batch-pdf-export.spec.ts --grep 'a later long question|long tables continue|cancelling during continuation|a fitted question|print stems preserve|print notes render|reprocesses only the current|explicit refinement uses|refinement truncation|prepared storage failure reveals|busy progress and cancellation|cached preparation read|batch PDF keeps ordered' --reporter=line --output=.runtime/pdf-auto-pages-2026-10-21/browser-final-results`：34项通过，退出0，见browser-final.log。
- `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`：均退出0，见typecheck-root.log与typecheck-mobile-delivery.log。
- 将数学适配统一到建帧/接入入口，避免打印时逐题反复适配整文档；最终构建沿上条浏览器命令仅筛选`a later long question|a fitted question|batch PDF keeps ordered`，8项通过、退出0，见browser-delivery.log，不与34项累加。合成2逻辑题分别生成6页（多段）和4页（单长段），全文与页眉像素检查通过。
- `pnpm lint`：最终退出0，见lint-final.log；首次因笔记的“背景”“放弃的方案”章节名称不符合现有模板退出1，原日志lint.log保留。边界与文档检查均通过，`git diff --check`退出0。

浏览器场景核对整批后续长题的多段/单长段、中英文及代理对全文、公式数量、题图数量、原题号与续页标签；下载真实PDF核对物理页数和共同页眉像素，检查续表每行仅出现一次、表头重复及取消后帧释放。旧路径覆盖短题字号/页脚、显式精修及截断、保存失败和原始记录；模型调用数量与历史不变均有断言。

## 范围与交付

此轮没有真实模型调用，原始27题截图/用户浏览器历史未直接验收；不声明识别或答案已正确。未构建APK，未做Android真机、Mac/iOS或独立后台队列验收。单个无法拆分的超大公式/图示、超宽内容及超过页数/耗时/体积限制仍会明确失败。

已更新现有`http://127.0.0.1:3100`：新增7个哈希资源，原子切换入口且保留旧资源和入口备份，不重启服务或操作历史。首页、12项入口资源及7项新增资源均返回200；路径和哈希见publication.json。测试PID与45383端口已清理，3100仍返回200，见cleanup.json。
