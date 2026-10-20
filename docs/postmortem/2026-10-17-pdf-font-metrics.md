# PDF 字体度量缓存实验与字体替换回归

日期：2026-10-17（Asia/Shanghai）。

范围：现有 Web 服务、html2canvas 1.4.1、同一份已准备的 27 页批次。使用隔离浏览器存储副本；关闭业务模型请求；不修改产品源码、安装依赖或替换现有构建。私有脚本与产物保存在忽略目录 `.runtime/pdf-production-2026-10-16/`。

结论：单副本有界数值缓存具有可测收益，但第一版在替换已加载字体时复用了旧度量。已保留失败并修正字体身份失效；单批画质通过不是通用缓存正确性或产品接入验收。字体缓存仍未接入，生产流畅性目标未完成。

## 变更与处理

### 测量文档与所有权

[导出实现](../../apps/mobile/src/local/download-batch-pdfs.web.ts)为每页调用新的 html2canvas。依赖的 `CanvasRenderer` 使用模块全局 `document` 创建 `FontMetrics`，不是题目、打印或克隆文档的 `ownerDocument`。其原始缓存仅属于单个实例，键为精确的 `fontFamily + ' ' + fontSize`；探针在测量文档 body 下临时插入节点，读取几何后删除，结果只有 baseline/middle 数值。

因此，[打印框架](../../apps/mobile/src/local/print-batch.web.ts)等待打印 iframe 的 `fonts.ready`，不直接证明主页面字体已就绪。字号保持原始精度，未按变换或 DPR 预乘，也未合并字体族。实验不更换测量文档，不共享保留 Document 的原库实例。

[队列](../../packages/client/src/local-export-tasks.ts)串行的是 runner；导出 `bounded()` 取消不会同步终止原始渲染。探针在打印 iframe 挂载时固定任务身份，在原树解析入口绑定 context，再在字体实例创建时固定归属。结束后关闭代次并清空映射；新任务使用独立 Map，副本切换清空并隔离精确键。迟到调用跳过缓存。此设计不构成原生资源已静默的证明。

### 私有包装与门槛

生成器对实际分发的 renderer 校验 SHA-256，再通过语法树仅包装原度量函数、实例绑定和树解析入口。原函数体保持不变，两臂使用相同包装。浏览器内的 DOM 追加和原库方法拦截仅属于隔离实验，没有持久编辑 node_modules、磁盘产物或产品 API。仅修改 `dist/lib` 不会证明命中产品的动态导入入口。

缓存上限为 256 键，只保存两个有限数值，返回新的数值对象；主测量文档、字体就绪、继承样式及副本键均参与门禁。第二版增加 FontFace 弱身份和描述符状态，替换已加载字体也使旧值失效；字体集合超过 256 个时跳过缓存。诊断明细也有独立上限。

## 验证结果

### 首对画质及剖析

`inspect-font-metrics-r32.py --mode control/cache --quality --profile` 两次退出码均为 0。每次先取消两次 20 份请求，再以一份完整导出恢复。取消测试不等于完整完成 20 份导出。

恢复阶段为 CPU 4 倍降速，含 RGBA 读取和 CPU 剖析，不能当作无仪表产品耗时：

| 指标 | 原始度量包装对照 | 第一版缓存 |
| --- | ---: | ---: |
| 完整恢复导出 | 25.5015 s | 20.6978 s |
| 度量入口调用/命中 | 158 / 0 | 158 / 137 |
| 原始度量累计耗时 | 2761.6 ms | 378.9 ms |
| 含门禁的累计耗时 | 3788.4 ms | 587.8 ms |
| 最长主线程任务 | 869 ms | 814 ms |

`verify-font-metrics-r32.py font-r32-control-a font-r32-cache-a` 退出码 0。两份 PDF 内的全部 JPEG 和全部逐页 RGBA 哈希相同；每次只有一个成功下载，存储成品和下载的字节数、哈希相同，取消后无成品。业务模型请求、页面异常、结束后 iframe 均为零。文件元数据可不同，未要求完整 PDF 哈希跨运行相同。

### 已加载字体替换：失败后修正

合成所有权测试最初 6 项通过、1 项失败，退出码 1；失效处理后 7 项通过。随后补返回值隔离、描述符变化、键/字体集合容量及字体检查异常回落，最终 12 项通过，退出码 0。它们使用模拟 DOM，不代替浏览器验证。

真实浏览器加载 KaTeX 的两个本地字体文件，使用同一自定义字体族，删除旧 FontFace 并加入已经加载的新 FontFace。前后 `document.fonts.status` 都为 `loaded`，继承样式相同：

| 结果 | 旧字体 | 新字体应得 | 第一版实得 | 修正版实得 |
| --- | --- | --- | --- | --- |
| baseline / middle | 30 / 19 | 24 / 13 | 30 / 19 | 24 / 13 |

第一次字体夹具路由把 Playwright Request 作为响应体，未形成有效反例；保留日志、停止挂起进程后修正回调，并为页面评估增加超时。重试确实以 `STALE_LOADED_FONT_METRICS` 退出码 1；修正版同一检查退出码 0。没有移除或放宽失败断言。

### 修正版复测

修正版含 RGBA 与剖析的完整恢复导出为 20.7179 s，158 次度量中命中 137 次。随后关闭 RGBA 读取和 CPU 剖析，按对照 B、候选 B、候选 C、对照 C 顺序串行运行；仍保留轻量计时和度量仪表，不称为无仪表产品基准：

| 修正版运行 | 包装对照 B | 缓存 B | 缓存 C | 包装对照 C |
| --- | ---: | ---: | ---: | ---: |
| 恢复导出 | 21.0548 s | 18.2980 s | 18.2699 s | 22.1943 s |
| 最长主线程任务 | 613 ms | 514 ms | 418 ms | 711 ms |
| 度量调用/命中 | 158 / 0 | 158 / 137 | 158 / 137 | 158 / 0 |

各臂只有两次计时，不外推长期稳定百分比或真机收益。峰值长任务仍超过流畅性目标。

两版合计 7 次完整恢复导出、14 次取消请求均通过；这是同一批次重复验证，不是 7 个新样本。189 页内嵌 JPEG 一致，3 次画质运行的 81 页 RGBA 哈希一致。独立校验确认输入快照、受测产品源码与当前构建指纹未变，第二版运行时除开关外字节一致。每次存储/下载一致、业务模型请求及页面异常为零、结束后无 iframe；未推断底层原生资源已静默。

完整校验命令为 `verify-font-metrics-r32.py font-r32-control-a font-r32-cache-a font-r32-cache-v2-quality font-r32-v2-control-b font-r32-v2-cache-b font-r32-v2-cache-c font-r32-v2-control-c`，退出码 0。

## 证据位置与复现

忽略目录内保留：

- `patch-font-metrics-r32.cjs`、`inspect-font-metrics-r32.py`、`font-metrics-runtime-r32.js`：精确入口包装、两臂驱动及修正版。
- `font-r32-control-a/`、`font-r32-cache-a/`：实际执行源码、CPU 剖析、逐页哈希、PDF、输入快照及成功/取消记录。
- `test-font-scope-r32.cjs`、`r32-font-scope-red.log`、`r32-font-scope-green.log`：合成边界红绿测试。
- `check-font-replacement-r32.py`、`font-r32-replacement-red-retry/`、`font-r32-replacement-fixed/`：真实字体替换红绿证据；失败夹具日志另保留。
- `font-r32-cache-v2-quality/`、`font-r32-v2-control-b/`、`font-r32-v2-cache-b/`、`font-r32-v2-cache-c/`、`font-r32-v2-control-c/`：修正版画质与交错计时。
- `verify-font-metrics-r32.py`、`r32-font-all-verification.log`、`r32-font-verification.json`、`r32-font-scope-final.log`：完整独立校验及最终合成测试。首对日志另保留。

原 renderer SHA-256 为 `7cc66a511335601454c1f079eeedcd827950ac1928cc988998432e5491f897de`；三处包装后为 `8a770b7051cb68225a87d908fc7b3c95a56d26000a9f12d24c087104f3d3b937`。剖析运行使用 CDP 取回实际执行脚本核对，而不是用会绕过拦截的普通请求代替执行证据。

## 未验证项与剩余风险

通用 div/span/img 规则、CSSOM 原地修改、特殊字体回退、字体加载失败、各阅读/作答布局以及取消 A 后原渲染迟到与 B 真正交错，尚未形成完整门禁。普通点击取消并观察按钮恢复或 iframe 删除，不证明原生渲染静默。

还需可维护的精确版本 runtime/types 接入、默认分支等价和现有构建入口验证。私有包装未成为公开能力，当前 UI 和构建未因本实验更新。本次没有重新构建或运行应用单元测试，不借用先前成绩声称本次产品回归通过。后续 CSSOM/媒体反例、修正与扫描成本见[样式验证](2026-10-17-pdf-font-styles.md)，持久取舍见[候选笔记](../../.agents/notes/proposed/storage/2026-10-17-pdf-font-metrics-cache.md)。
