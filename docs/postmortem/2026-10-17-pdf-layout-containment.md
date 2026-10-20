# PDF 离屏布局隔离实验

日期：2026-10-17。

范围：本机 3100、Chrome 154、CPU 四倍降速；同一隔离真实批次、已存整理内容与作答配置。接续[字体源代次实验](2026-10-17-pdf-font-source-epochs.md)，仅考察离屏外壳的 `contain:layout`。

结论：逐页保真和取消恢复通过，但交叉计时未形成提速，布局工作计数也未减少；不接入产品。产品、UI、构建和服务入口保持原状，整体生产验收仍未完成。

## 变更与处理

[隐藏根](../../apps/mobile/src/local/batch-export-root.web.tsx)实际为 fixed、800px 宽、自动高；采样确认 computed contain 为 none，而非仅依据源码缺少声明。质量场景各三次挂载的外壳均高 26914px、包含 4405 个后代；候选仅把 contain 改为 layout，几何不变。

浏览器私有路由在 append/mount 前精确替换主包中的唯一 CSS 字面量，未新增让步或更换测量 Document。原包 SHA-256 为 `bad8bf252d3525ceed1057063b03213495e22f2e719f3c03b3eee1e1c6f9b109`，派生包为 `0089070ff92753e751ea2225c124c7b71fa6a35f229b7bc7a08968b51535fb5e`；质量场景另读取实际执行脚本校验来源。保留原 renderer 的轻量度量/归属诊断，关闭数值缓存及字体/样式守卫，不与带扫描成本的旧对照比较。

[打印框架](../../apps/mobile/src/local/print-batch.web.ts)只克隆返回的 main，不克隆外壳；但[数学效果](../../apps/mobile/src/dom/math-text.tsx)会写入随后被克隆的内联字号，所以复制边界本身不足以推出保真。fixed 外壳原有的格式化和层叠上下文也使 layout 的部分作用冗余。

## 验证结果

质量诊断读取 computed style/高度并启用 CPU profile、布局 trace 和 RGBA 哈希；交叉计时去掉这些操作，仅记录内联属性和直属孩子数。两组分开解释，浏览器场景串行执行。

| 无剖析执行顺序 | 整批秒 | 最长任务毫秒 | CPU4 取消至清理毫秒 |
| --- | ---: | ---: | ---: |
| 原路径 A | 20.4651 | 556 | 227.9 |
| layout A | 22.9563 | 672 | 256.9 |
| layout B | 20.6171 | 661 | 251.0 |
| 原路径 B | 19.9510 | 655 | 301.1 |

每臂只有两个计时样本，不宣称稳定退化百分比；取消样本交叠，也不宣称普遍变慢。四场景 Performance 指标均为 645 次 Layout、595 次 RecalcStyle，没有减少工作计数。

另两场质量诊断的主文档 trace：原路径/layout 各 389 次 Layout（629.6/624.2ms）、366 次 UpdateLayoutTree（2314.6/2337.1ms），无 trace 数据丢失。此窗口与 Performance 指标窗口不同，不混算为精确归因比例，也不把相关性当作某个探针的独立因果证明。

独立核验六次恢复的 162 页嵌入 JPEG 均与原对照相同；两场诊断的 54 页 RGBA 也逐页相同。十二次取消保留 cancelled 终态、无文件/下载，之后均成功下载并核对保存字节，源数据快照不变、末态 iframe 为零。都是同一批次的重复验证，不是六批新题或完整二十份容量复测；新增业务模型调用为零。

另运行隔离空白文档夹具：layout 下 fixed 后代确实从视口改以离屏外壳为包含块，absolute 几何、自动高增量及计数器宽度保持一致；只克隆 main 后两臂一致且无外壳。此为真实浏览器边界，不是产品三模式全覆盖，也不把 layout 当作 size/style/paint containment。

证据位于 `.runtime/pdf-production-2026-10-16/`：`r35-final-layout-verification.json`、六个 `layout-r35-*` 场景、`layout-r35-boundary/result.json`；含原包/派生包、执行来源、冻结驱动、trace、成品与原始日志。实际执行以下入口及各自 `--help`，退出码均为 0：

```sh
python3 .runtime/pdf-production-2026-10-16/inspect-layout-r35.py --name layout-r35-control-quality --layout none --quality --profile --layout-trace
# 候选同入口，name 为 layout-r35-candidate-quality，layout 为 layout。
# inspect-layout-timing-r35.py 按上表顺序运行，不传 quality/profile/layout-trace。
python3 .runtime/pdf-production-2026-10-16/check-layout-boundary-r35.py
python3 .runtime/pdf-production-2026-10-16/verify-layout-r35.py --output r35-final-layout-verification.json layout-r35-control-quality layout-r35-candidate-quality layout-r35-timing-control-a layout-r35-timing-candidate-a layout-r35-timing-candidate-b layout-r35-timing-control-b
```

## 未验证项与剩余风险

未改产品，因此未运行新的应用构建、类型或单元回归；本次没有覆盖其它批次、阅读版、冷/热字体矩阵或真实 A/B 迟到原生交错。末态清理不等于原生工作静默；最长任务仍在。[字体缓存笔记](../../.agents/notes/proposed/storage/2026-10-17-pdf-font-metrics-cache.md)继续保留不接入决定。

另从当前成品直接提取重点页目视核对：第 19 页图示仍见深色侧边、蓝色底边，第 23 页图边仍见残留文字；证据在 `r35-visual-reference/manifest.json`。这仅证明该隔离样本的可见残留，尚未核对其处理缓存版本，不能据此断言当前清晰化处理器失败。后续先区分旧缓存待更新与当前缺陷，再处理图示质量，保持原图、标签及曲线含义；局部抽查不替代逐页视觉验收。

规范参考：[MDN contain](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain)、[CSS Containment Level 1](https://www.w3.org/TR/css-contain-1/#containment-layout)。规范只解释边界，不代替上述实测。
