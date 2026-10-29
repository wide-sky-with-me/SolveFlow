# 真实40题多份PDF超过原累计容量

日期：2026-10-22。范围：Mac3131的快速原文10份作答、指定错题数循环1至4，以及整理试卷的同一配置；仅用Windows该站点IndexedDB的私有副本，不写用户原库、不调用模型。

## 变更与处理

原代码把原图快照预算同时用于单份PDF与多份累计成品，实际每份正常仍在累计128MiB时终止。分别保留单份128MiB与原图/排队预算，将多份ZIP成品限定512MiB；生成、打包、任务元数据与IndexedDB保存沿同一契约。快速原文加入完成副本后的真实大小预估，取消优先及完整保存不变。兼容与内存取舍见[决定](../../.agents/notes/implemented/storage/2026-10-22-multi-copy-pdf-capacity.md)，当前行为见[批次PDF](../subsystems/batch-pdf.md)。

## 已执行验证

Node24.19.0、pnpm11.7.0、Linux Google Chrome；证据位于权限700的`.runtime/pdf-capacity-2026-10-22/`。

- `unit-before.log`：补回归后旧代码3项失败、115项通过，退出1；包含十份累计与大ZIP元数据拒绝，未把首次失败覆盖为通过。
- `actual-before.log`：218文件、约223MiB该Origin副本读取最新40题，快速原文10份复现截图的128MiB拒绝，脚本退出0表示成功重现预期失败，不表示导出通过。
- `unit-final.log`：`pnpm exec vitest run --project unit`定向资源、绘制范围、页界、快速内容、任务契约和客户端导出队列6文件，229项通过，退出0。包括两种生成器的10份累计、单份边界、总量边界、预估取消及PDF/ZIP元数据分别限额。
- `pnpm build:web`、根`pnpm exec tsc --noEmit`与移动端`pnpm --filter @solveflow/mobile typecheck`均退出0。
- 首次打包`package.log`因沙箱`spawnSync git EPERM`失败；同一脚本在新目录重试，`package-retry.log`退出0，未修改发布脚本或覆盖旧包。
- `browser-after.log`：`pnpm exec playwright test`定向`batch-pdf-variants`、`paper-preparation`、`batch-pdf-export`，筛选`quick parsed|table-rich pages|reading PDF downloads`，10项桌面/窄屏通过（35.2秒），退出0；验证带答案/纯题、10份真实ZIP下载、取消、表格及阅读版正文。全部合成数据、模型拦截。
- `pnpm lint`的源码边界通过；文档首次因批次PDF页超长失败，后精简重复说明，`lint-passed.log`退出0，339当前页、103决策、174源码锚点、108冻结页。不调整长度或冻结策略。

## 实际大文件结果

隔离Chrome加载本地构建，所有外部和模型请求被拦截；每批设置10份，错题数为1/2/3/4循环。后台完整成品写入副本导出库后读取，逐条检验ZIP中央目录、PDF文件头、页数及CRC。结果不含原题文字或图像。

| 版式 | 题数 | 份数 | ZIP字节数 | 每份页数 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 快速原文 | 40 | 10 | 257273205 | 47或48 | 保存成功，10项CRC通过 |
| 整理试卷 | 40 | 10 | 228984583 | 67 | 保存成功，10项CRC通过 |

详情见`actual-after-direct.json`与`actual-after-paper.json`，模型调用0。这验证实际后台成品与保存链路，未把它声明为Windows原浏览器已实际接收两个大文件。小样本原生下载由浏览器回归单独验证。

## 发布与清理

发布`20261022-pdf-capacity`至Mac原3131，入口SHA256为`1aa10666b1ad74bca921334d742aa38b7464e1867b2e6e574bf8260c800d835d`。`remote-activate.log`退出0；模型状态指纹、其他服务容器ID和16/16并发保持，网关未重启，旧版本及私有回滚备份保留。`remote-smoke.log`退出0：证书/入口摘要、来源边界、安全上下文均通过，模型调用和配置写入0。

`browser-remote.log`在实际新3131上执行合成10份快速ZIP下载，通过1项（9.5秒），退出0；先独立验证固定TLS证书，测试浏览器允许自签，配置及模型入口均拦截，未触碰Windows原库。

删除真实题库副本及其中PDF成品，关闭本轮测试服务与SSH主连接；远程临时上传包按SHA256核对后删除。保留脱敏统计，见`data-cleanup.json`及`remote-cleanup.json`。原工作树基线1201项，修改9项、新增2项、删除0，其余1192项保持；没有提交、推送或重置。报告补全后的`pnpm docs:check`结果见`docs-final.log`。

## 限制

512MiB是输出上限，不等于内存峰值；累计导出库存储预算未扩大，空间不足沿补存流程处理。未进行手机原生内存压力、Windows系统下载接收或付费模型验收；容量修复不改变原回答的准确性。
