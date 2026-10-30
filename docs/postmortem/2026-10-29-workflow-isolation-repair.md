# 补图首轮范围、删除隔离与答题中插入验收

日期：2026-10-29。

范围：当前未提交工作区的本地客户端、批量队列及隔离Web；Node24.19.0、pnpm11.7.0，合成图片与假模型。沿用前一轮修改，不代表Mac或原生包已更新。

结论：两处已复现缺陷修复；答题中新增插入不取消、重放或串写旧任务，显示位置与FIFO派发顺序分离。185项单元、24项浏览器、类型与Web构建通过；真实模型与原生路径未验。

## 变更与处理

- 首轮失败/取消后，补图通用消息覆盖明确题号，而失败历史未送模型；不同消息又不能被多题重试投影合并。补图计划现保留原非辅助请求原文及当前用图。有答案时继续按原题上下文逐题重答，不放宽不同请求的合并规则。
- 删除生成讲解中的单题时，旧全局布尔守卫拒绝另一批次下一题，队列误判启动失败并清除后续等待项。守卫现保存目标ID集合；局部删除只拒绝目标题新任务，全库清空保留全局保护。取消收尾、事务、待保存结果与迟到结果规则不变。
- 插入新增题图仍按稳定ID更新位置。新回归同时保留一题核验、一题答题及一题等待，在核验题前、答题题前连续插入两张；验证旧run和原图不变、信号不取消、答案只写回原ID、每题只执行一次、最终位置连续。新题按提交顺序排队，不抢占旧等待项。已有“调整批次图片”仍先停止本批，不宣称实时重排不中断。

实现和长期原因见[决定](../../.agents/notes/implemented/architecture/2026-10-29-supplement-scope-and-deletion-admission.md)；当前行为归[补图](../subsystems/batch-materials.md)、[生命周期](../subsystems/local-run-lifecycle.md)、[顺序](../subsystems/batch-order.md)。

## 验证结果

证据目录为忽略的`.runtime/workflow-isolation-repair-2026-10-29/`，保留首次失败与复测，不累计重复样本。

| 检查 | 命令与实际结果 |
| --- | --- |
| 修复前回归 | `pnpm exec vitest run --project unit --maxWorkers=2`定向两个材料/隔离文件：6失败、27通过，退出1；消息被覆盖4例，删除阻断2例 |
| 修复后扩展 | 同入口定向12个文件：185通过、退出0；选择见`verification.json`、成绩见`unit.log`，覆盖引擎、历史、存储故障、队列、插入、多题投影、运行时与页标识 |
| 独立故障探针 | `node .runtime/workflow-isolation-repair-2026-10-29/probes.mjs`退出0：原题号保留，导出2题且无空题；删除期间他批下一题执行1次且无批次错误 |
| 共享构建 | `pnpm build:workspace`退出0 |
| 类型 | `pnpm exec tsc --noEmit`与`pnpm --filter @solveflow/mobile typecheck`均退出0 |
| Web产物 | `node scripts/prepare-mobile-assets.mjs`及`pnpm --filter @solveflow/mobile exec expo export --platform web --output-dir ../../.runtime/workflow-isolation-repair-2026-10-29/web`均退出0 |
| 浏览器 | `pnpm exec playwright test`定向`batch-pdf-retry`、`batch-import`、`batch-materials`、`batch-management`四文件，用`--grep`选择12类场景：桌面12、窄屏12，24通过、退出0；准确选择与成绩见`browser.log`。自建44895端口、无环境桥接 |
| PDF实际产物 | PyMuPDF复核普通重试/补图两路径、桌面/窄屏共4份下载：各2页、书签为答案表及两道题，无额外空题书签，见`pdf-check.json` |
| 源码与文档 | `pnpm lint`与`git diff --check`均退出0；文档408页、124篇决定、207处源码锚点、108篇冻结档案检查通过 |

旧探针以“等待缺陷出现”为终止条件，修复后再运行会因不再出现错误而超时，不能作为修复后验收；新探针等待下一题完成。初次文档检查在报告未创建时报告链接缺失，随后lint发现状态页超限11单位；精简重复导航后复查，不提高门槛。

## 未验证项与剩余风险

没有真实模型调用、手机相机/SQLite、原生构建或长时间负载测试。插入事务与结果落盘共用存储锁，模型执行继续，写入可短暂等待，不保证无性能开销。不同明确消息的失败历史仍不会猜测合并；旧版已保存错误消息不会被本次修改自动重写或重新付费执行。

本机3100已更新：29个构建文件HTTP内容逐一匹配，保留117个旧资源、用户配置及原服务进程，见`publication.json`。隔离浏览器首页HTTP200、无页面异常及模型请求，见`local-smoke.json`；自建44895测试服务已停止。没有提交、推送或部署远程Mac。
