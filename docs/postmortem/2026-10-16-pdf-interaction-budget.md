# PDF 启动计数与实际出图取消复测

日期：2026-10-16。范围：Linux Chrome 154、本机既有 Web 服务、隔离 QA 批次；不是整体生产验收。

## 复现与定位

使用已保存的 27 题批次、原始整理缓存，先配置 20 份，在已实际执行 JPEG 编码后取消，再以单份验证恢复。各次从同一只读来源提取存储到独立浏览器上下文，不运行模型、不修改来源库。此样本未重放[上一轮](2026-10-16-pdf-copy-quantities.md)的十次四角编辑，不替代其图示校样或已交付成品。

初次脚本误将 files 值当作含 id 的记录，取消后取证触发 KeyError；这是脚本故障，不是产品失败。修正为按文件主键查询后重新完整执行，保留失败目录。随后对正常速度与 CDP 四倍 CPU 降速取基线；另一次 CPU 采样仅用于定位，不与无采样计时混为性能对照。

基线正常速度首个长任务 359ms，四倍降速 1425ms。调用栈包含 submit 中整段 JSON/UTF-8 分配及多次快照 schema 图片验证。独立字符串研究未证明等价正则对有效正文稳定加速，自定义校验还影响 schema/error 元数据，因此保留图片验证；重复解析留作后续单独处理。

## 本次修正

[精确计数](../../apps/mobile/src/local/export-input-bytes.ts)在 JSON 遍历时省去较长、不需转义的 ASCII 字符串正文，按长度补回字节，只编码剩余 JSON。标准转换、重复引用、Unicode/转义与原容量判定不变；完整输入仍按原时点冻结。取舍见[决策](../../.agents/notes/implemented/storage/2026-10-16-export-input-byte-accounting.md)。

[回归](../../apps/mobile/src/local/export-input-bytes.test.ts)先以原算法复现：给 UTF-8 编码器传入 3,145,841 字符的整段内容，超过测试的短缓冲断言；其余四项当时通过。新算法五项通过，覆盖容量等号上下边界、重复引用、只读对象、Unicode、转义、toJSON、未定义值与原有异常。

## 复测结果

改后两次独立回放，正常速度首个长任务为 187/192ms，四倍降速为 840/815ms。只证明该样本首段阻塞下降；后续仍有 1406/1213ms 长任务，整体流畅尚未达标。心跳延迟与长任务不是 INP，也不是实机帧率。

改后正常速度取消至清理的自动化端到端耗时为 84/166ms，四倍降速为 295/324ms；包含驱动与断言等待，不是原始触控延迟。四个取消案例均已编码多页，终态 cancelled，无新文件或下载，打印框与隐藏渲染根释放；原题及整理缓存哈希保持一致。此处未生成完整 20 份压缩包。

每次取消后均在四倍降速下成功保存并下载 27 页 A4；两次均为 6,565,217 字节，下载与当次存储 SHA-256 一致，模型请求和页面异常为零。两份 PDF 分别与改前基线在 144DPI 比较，27/27 页像素相同；PDF 元数据使不同运行的文件哈希不同，不要求跨运行字节相等。后一次成品 SHA-256 为 `bd53e3cf2e8d73c2ee3f1ae6bd11236891f998f15e213bf2ad345d1a4276b527`。

实际新页面加载 `index-d0f7adc5d2368a8f49d372ed41124cc5.js`，确认使用新构建而非旧缓存。原始报告、CPU 采样、截图和像素比较位于忽略目录 `.runtime/pdf-production-2026-10-16/interaction-r18-*`；脚本为同目录 `inspect-interaction-r18.py`，每次使用新输出目录。

## 检查与限制

`pnpm exec vitest run apps/mobile/src/local/export-input-bytes.test.ts apps/mobile/src/local/batch-pdf-resources.test.ts packages/client/src/local-export-tasks.test.ts`：59 项通过；根与移动端 TypeScript 检查、Web 构建与上述真实回放均退出 0。

`pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts --output=.runtime/pdf-production-2026-10-16/e2e-input-bytes-r18`：桌面与窄视口合计 66 项通过，4.1 分钟，退出 0，覆盖取消、重载中断、仅重试保存、副本 ZIP、数量草稿与缓存恢复。`pnpm lint`、文档检查及 `git diff --check` 均退出 0；Node 版本及颜色变量警告仍在，未调整运行环境。

仍需处理重复快照验证与后续绘制长任务。未检验物理设备、实打印、Firefox/WebKit、低内存或持续长时负载；Playwright 默认位置未发现 Firefox/WebKit 可执行文件。四倍降速与窄视口不代表真机。产品模型累计调用保持 67，本轮新增 0；源题内容疑点沿用图像验收结论。
