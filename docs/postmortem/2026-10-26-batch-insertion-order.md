# 批次指定插入与可选导出排序验收

日期：2026-10-26。

范围：本地批次创建/保存、拍摄与相册入口、Web导出快照和副本计划。全部题图和模型接口为合成夹具；没有真实付费调用、远程Mac部署或用户数据迁移。

结论：新图可插入指定题图之前，后续序号顺延；导出可按题图调整顺序，保持同图分组和稳定作答关联。459项客户端/契约回归、22项桌面/手机视口浏览器检查通过；原生真机及系统打印窗口未验。

## 变更与处理

批次操作默认追加到末尾，可切换“插入指定位置”。位置解析为同批稳定题图ID，连续新图按确认顺序插在同一目标之前。[仓库](../../packages/client/src/local-repository.ts)一个事务保存新图及受影响元数据/摘要；目标不存在、重复编号、归属变化、无事务或空间不足时拒绝，不留下半套顺序。默认末尾使用原保存路径，既有导入读取性能回归保持通过。

后台解题可能持有旧position，普通保存现采用仓库当前批次位置，防止迟到结果覆盖插入后的顺序；原图、补图、已有解答和run快照按原ID保留。旧内联图片在移位时仍保留字节，不重写分离图片键。

导出窗口新增“调整导出顺序（可选）”，可按题图移至指定位置或恢复批次顺序。[纯投影](../../packages/client/src/batch-print-order.ts)只重排当前快照和显示题号；同图多题仍成组。副本计划按原问题集合生成，再按key重排，移动不重抽错题、不重置份数、备注、参照或作答。原始批次记录不变，任务提交后按既有克隆冻结快照。

当前语义与边界见[批次顺序](../subsystems/batch-order.md)，原因见[决策](../../.agents/notes/implemented/storage/2026-10-26-batch-insertion-export-order.md)。

## 验证结果

Node24.19.0、pnpm11.7，仓库根执行；完整参数、日志、源码快照及合成PDF/ZIP在忽略目录`.runtime/batch-insertion-order-2026-10-26/`。

| 实际命令 / 检查 | 结果 / 退出码 |
| --- | --- |
| 修改前`pnpm exec vitest run packages/client/src/local-batch-insertion.test.ts packages/client/src/batch-print-order.test.ts` | 插入3失败，排序模块尚不存在导致加载失败 / 1 |
| `pnpm build:shared` | 共享构建通过 / 0 |
| `pnpm exec vitest run packages/client/src packages/contracts/src/batch-print-variants.test.ts packages/contracts/src/export-task.test.ts` | 30文件459通过 / 0 |
| `pnpm typecheck`及新增浏览器测试后的`pnpm exec tsc --noEmit` | API、共享、移动端及测试类型通过 / 0 |
| `pnpm --filter @solveflow/mobile build:web` | Web构建通过 / 0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45185 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-import.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts --grep 'optional export order\|quick parsed multi-copy\|appending an import\|existing batch\|batch capture previews'` | 桌面/手机视口18通过 / 0 |
| 同一隔离URL执行`pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-pdf-variants.spec.ts --grep 'optional export order also'` | 额外4通过 / 0 |
| `pnpm lint`，包含`pnpm docs:check` | 边界、文档和冻结资料检查通过 / 0 |

单元覆盖首尾/中间和连续插入、事务失败无前缀、无事务拒绝、迟到模型结果、旧内联/分离原图保留、完整成员排列及同图小题分组；错题key、作答与备注重排后保持对应。

浏览器从相册入口及拍摄入口的相册选择各连续插入三张，核对新旧图的像素颜色、顺序、连续编号和旧session不变。原追加读取性能、停止/迟到保存、伪相机回归保持通过。实际快速原文作答ZIP、纯题PDF核对正文顺序和书签存在，份数/错题数/备注保留且数据库记录不变；保存版纯题PDF及原始记录预览也按新顺序显示。

另用PyMuPDF检查6份快速PDF（包含ZIP内作答副本），确认原第2题先于原第1题，两个题目书签的目标页均包含对应重排后的正文；细节保存在私有`pdf-inspection.json`。状态页首次超过长度门槛，精简后通过，未提高上限。

## 未验证项与剩余风险

指定位置按题图选择，不拆分同图内的小题；不跨批次移动。插入逐图提交，停止不删除已成功加入项。重复/异常位置须先显式调整，不能靠插入静默猜顺序。

手动导出排序保留已选错题，新位置可能相邻；不会为重新分散而替换具体错题。原生相机的指定插入、Android/iOS真机、系统打印和任务重启恢复未专项验收；现有后台捕获顺序使用同一实现，本次前台成品生成经过该任务路径。

本地Web已构建，未更新远程Mac，未更改模型配置或自动重放历史请求。
