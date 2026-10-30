# 图片工作台与保存草稿

本页维护图片弹窗的共用交互、草稿及预览资源；导入位置、补图绑定、任务与持久化语义由对应子系统维护。

## 共用交互

新增题图、补图确认和已有批次调整沿用[共用弹窗](../../apps/mobile/src/components/batch-import-dialog.tsx)：标题与提交区固定，中部滚动，浅色、深色及短横屏共用布局。主界面只显示操作对象及选择结果，不常驻移动、裁剪和旋转工具栏。

[缩略卡片](../../apps/mobile/src/components/import-photo-card.tsx)单击只选择当前图，右上角小叉移除草稿项；底部透明小按钮单独打开精细操作。新导入图的文件名、尺寸及大图预览放在[图片操作弹窗](../../apps/mobile/src/components/material-photo-tools.tsx)，查看、裁剪及旋转按需执行；已有题图只提供查看和位置调整，不覆盖保存原图。

## 操作与保存

| 入口 | 选择对象与确认效果 | 详细规则 |
| --- | --- | --- |
| 首次相册导入 | 调整新图顺序，确认后保存并解题 | [批量导入](batch-import.md) |
| 已有批次新增 | 选择新图，再用编号网格指定插入点；默认末尾 | [新题插入](batch-order.md#新题插入) |
| 批量补图 | 选择补图，再绑定一题或多题；保存后只重答接收者 | [补图与自动重答](batch-materials.md) |
| 单题多张补图确认 | 保存本题材料，后续重答仍需用户提交 | [材料版本](local-run-lifecycle.md#材料与答案版本) |
| 调整批次图片 | 在草稿中移动或移除已有题图，确认后停止本批并保存 | [批次调整事务](local-run-lifecycle.md#取消保存和删除) |

所有选择和位置调整在提交前都是草稿，取消不写库、不调用模型。单题补图移除后序号连续，保存失败保留整组草稿。已有批次的卡片底部“调整位置”打开原图查看及上下移动，标题随草稿位置更新；移除仅改草稿，实际删除仍需保存确认。取消保留原顺序，保存不自动重放解题。

## 单张保存失败

[裁切页](../../apps/mobile/src/components/photo-editor.tsx)等待调用方的提交Promise；[单张新增或编辑补图](../../apps/mobile/src/components/question-materials.tsx)成功才关闭。写入失败就地显示错误，保留原图和当前裁剪范围；用户可重试或取消，不必重新选图。

处理成品由调用方释放，再次提交按保留范围重新生成；重试不调用模型，也不覆盖旧图片证据。原记录和事务规则归[存储](storage.md)。

## 预览与资源

[导入预览](../../apps/mobile/src/components/import-photo-preview.tsx)按Photo对象去重，[保存图预览](../../apps/mobile/src/components/saved-photo-preview.tsx)按稳定ID去重，均使用[有界缓存](../../apps/mobile/src/photo-thumbnail-cache.ts)。按需生成独立小图，同时最多处理两项；满额先淘汰空闲项，移除或编辑来源后释放旧预览，关闭取消等待并回收迟到结果。预览失败显示占位，不回退加载大原图；缩略图不用于保存、裁剪或模型输入。

保存图入口`readPrimaryImage`只读取[仓库](../../packages/client/src/local-repository.ts)中的题目元数据和不可变原图，不解析v2分离补图。它不是完整记录验证：坏原图仍登记，I/O失败仍报告，补图问题由完整读及维护处理；旧v1仍需读取内联JSON。大图查看按需再次读取，不缓存整批原图。

导入横条与保存图网格使用不同容量：前者复用空闲预览，后者的小图容量覆盖现有批次上限，避免可见项全部占用时无法更新。保存图网格按固定行高定位，避免远距离滚动逐行估算。

资源所有权与容量取舍见[导入预览决定](../../.agents/notes/implemented/architecture/2026-10-29-retry-projection-and-import-previews.md)及[共用工作台决定](../../.agents/notes/implemented/architecture/2026-10-29-shared-image-workbenches.md)；实际测试范围由[验收记录](../postmortem/2026-10-29-ui-workbench-repair.md)维护。
