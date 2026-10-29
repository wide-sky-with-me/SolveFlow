# 实际批次表格重排导致PDF再次失败

日期：2026-10-22。范围：Windows Chrome访问Mac3131的40题批次，再次报告第1题内容过长。原长图选项修复未覆盖此故障；本轮只修打印帧模式，不改用户题库、答案或模型设置。

## 真实复现与根因

只读复制该Origin的IndexedDB约201MiB到权限700的私有目录，不复制Cookie、密码或其他站点。独立浏览器的所有模型/外部请求拦截，站点代码直接读本地构建。读取实际40题及整理缓存，状态“已整理，1题内容待核对”，复现截图错误。

实际栈在截图的onclone重测，而非原续页器。原打印帧无doctype、BackCompat；截图帧为CSS1Compat。原表格行高约26px，克隆为31.5px；同一题干616px增至673px。原帧图像缩排后正文1122px勉强通过，克隆1150px低于8pt缩排底线，抛出旧提示。几何及栈仅保留字符数、样式、尺寸，不含题文和图像。

在打印帧接入样式/题目之前只解析固定doctype声明，后续用户内容沿DOM克隆接入，统一标准模式。DOM直接插入doctype节点的空白实验仍为BackCompat，故未采用。当前语义见[打印分页](../subsystems/print-pagination.md)，取舍见[决定](../../.agents/notes/implemented/storage/2026-10-22-print-document-mode.md)。

## 验证

Node24.19.0、pnpm11.7.0；私有证据`.runtime/pdf-overflow-2026-10-22/`。

- `trace-before.json`与`reproduce-mode.log`：实际40题失败，无模型请求；初期Error跟踪钩子不兼容函数调用，修正后得到真实栈，未把钩子错误当产品根因。
- `browser-before.log`受并行构建更新静态文件影响未能加载题目，不算有效模式回归。改用未升级的实际3131，`browser-mode-before.log`明确失败：期望CSS1Compat、实际BackCompat。
- `reproduce-after.log`：同一实际40题成功生成67页、约22MiB PDF；用户原浏览器不变，无模型请求。内部缩排溢出由正常续页处理，不代表题目失败。
- `unit.log`：6文件207项通过，退出0；涵盖帧归属/资源等待、取消/迟到、页界、容量和导出资源限制。移动端类型检查退出0。
- `browser-after.log`：桌面/窄屏14项通过（49.9秒），退出0；合成表格全文与页数、长题、长选项、重复表头及续页取消均验证，未降低断言、字号或容量边界。
- `browser-reading.log`：`pnpm exec playwright test tests/mobile-e2e/batch-pdf-export.spec.ts --grep 'reading PDF downloads|cancelling reading PDF'`，指定本地合成数据测试站点，桌面/窄屏4项通过（15.9秒），退出0；共享打印帧的已保存内容下载、续页完整性和取消清理通过。
- `print-integrity.json`：实际40题的预览与67页打印逐题正文/图示哈希一致，标准模式；只在比较时去除自动重复的表头，未去除正文行。
- 实际批次的后续无头下载接收在Linux Chrome中触发原生SIGSEGV，`actual-stored.log`保留进程证据；未将它误记为应用返回的长题错误。首轮实际PDF已成功保存，后续逐批改验下载前的后台成品文件头、字节数和页数，数据范围与限制单列。

`actual-batches.json`及`actual-background.log`记录四个实际批次副本的默认试卷版式、每批一份后台生成结果；均保存成功且文件头为PDF，无模型调用、原库未写入。此项验证后台成品，不据此声明四批都通过了浏览器原生下载接收。

| 题数 | PDF页数 | 文件字节数 | 状态 |
| --- | --- | --- | --- |
| 40 | 67 | 22898797 | 成功 |
| 36 | 83 | 40330036 | 成功 |
| 45 | 45 | 5086289 | 成功 |
| 50 | 51 | 23044989 | 成功 |

## 远程发布

发布`20261022-print-mode`到原3131，入口SHA256为`26161027ca60b6a1b02df8728b02d00abbe842b4e79ce48dd5a86fa930f0cb8b`。`remote-activate.log`退出0：模型状态指纹、原3130/8000容器ID保持，网关不重启。`remote-smoke.log`固定证书及入口摘要、16/16配置、安全上下文和来源边界通过，模型调用0；`browser-remote.log`此前失败的标准模式回归在实际新页面通过（12.4秒）。浏览器使用独立合成库，不访问Windows原记录。

文件基线1199项中1195项保持，修改4项、新增2项、删除0；其他既有改动保留。Web构建、根/移动类型及`pnpm lint`通过，文档检查为337当前页、102决策、172锚点和108冻结页，未放宽门槛。

## 清理

验证后删除本轮私有浏览器副本、真实PDF及含实际记录的临时截图，仅保留脱敏几何、哈希和结果统计；原Windows库未改动。关闭临时本地测试服务及SSH主连接，按SHA256核对后删除远程上传压缩包，保留上线版本和回滚备份。证据见`data-cleanup.json`、`server-cleanup.json`、`remote-cleanup.json`。报告补全后执行`pnpm docs:check`，结果保留于`docs-final.log`。

## 限制

真实缓存副本导出不等于模型正确率或原生真机验收。标准模式可能增加实页数，逻辑题量和对错计划不变；没有通过删表格、去图或忽略溢出返回成功。
