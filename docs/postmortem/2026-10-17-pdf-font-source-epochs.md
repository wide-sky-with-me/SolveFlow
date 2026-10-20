# PDF 字体源代次候选与原路径成本对照

日期：2026-10-17。范围：本机 Web PDF 私有候选，续[样式快照验证](2026-10-17-pdf-font-styles.md)，不是产品接入或生产流畅性完成声明。

## 结论

减少字体源读取后，状态检测仍抵消原度量节省；暂缓字体缓存接入及更复杂失效模型，转查离屏主树布局隔离。产品源码、依赖、构建及 UI 本次未修改，没有新增应用单测或构建成绩。

## 成本拆分与候选

当前应用共 1276 规则，最大文本项是内嵌 KaTeX 字体源。四倍降速下完整快照约 21.5–26.1 ms/次，不读规则文本约 2.8–4.4 ms/次；只去最终 JSON 或改读全部字体声明仍约 17.5–24.0、20.7–20.9 ms/次。这是空闲主文档局部诊断；最大文本不等于最大耗时，不能外推整批收益。

候选保留普通规则、媒体、嵌套和未知声明的完整状态；字体规则用弱身份、声明名/值/优先级表示，不重复读取 `src` 值。源改变由 FontFace 弱身份与描述符代次追踪，先做字体匹配检查再采样字体集合。[CSS Font Loading 规范](https://www.w3.org/TR/css-font-loading/)要求源改变替换关联字体对象，CSS 关联字体按规则文档序迭代；规范不替代实测。字体规则限 64 声明，非 src 文字计原状态预算，字体资源本身不受该快照预算约束；其余边界沿用前报告。

关闭开关直接走原度量、不执行字体或样式门禁，避免人为拖慢对照；仍有轻量诊断与归属包装，不是无包装产品基线。

## 正确性门禁

新增继承变量与跨兄弟嵌套规则，旧字体候选两例均先以旧值断言失败，新候选九类样式夹具通过。CSS 字体源替换另测已加载和同步立即读取，先读候选再读原生，避免参照先刷新掩盖问题。两者字体代次 1→2、样式代次保持 1，关闭状态及字体清理通过独立核对。已加载度量 30/19→24/13；同步未就绪回落原度量，两者均 30/18，不假装字体已经加载。合成边界 40 项通过，不是实际原生 A/B 迟到交错。

选择器剪枝未实施：静态审查指出现存节点可经 counter/anchor/container 间接影响探针，不能由“不匹配 body”推出无关；这些构造仅静态推演。状态快照仍不保证通用布局完整性。

## 整批与成本

当前入口三次完整恢复、六次取消通过。独立核对新增 81 页 JPEG、27 页 RGBA 与原版相同，输入/当前入口/实际执行源码、保存下载、关闭状态及结束后 iframe 数量通过；业务模型与页面异常为零。仍是同批重复，未完成新的最大容量验收，原生资源静默未观测。

| 运行 | 恢复导出 | 样式快照累计 | 原度量累计 | 最长任务 | 取消至收尾 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 画质与剖析 | 24.1483 s | 3132.0 ms | 370.6 ms | 921 ms | 143.5 / 285.3 ms |
| 无剖析原路径诊断对照 | 20.2943 s | 0 ms | 2848.6 ms | 653 ms | 104.9 / 252.5 ms |
| 无剖析缓存 | 21.2189 s | 3045.4 ms | 331.5 ms | 836 ms | 77.3 / 387.5 ms |

恢复为四倍降速，取消分别原速/四倍降速，无剖析每臂仅一次。候选命中 137/158 次，但样式检测仍超过原度量节省，整批耗时、最长任务和降速取消样本未改善，不推断稳定收益百分比。对照门禁“跳过”与实际“不支持”分别计数，修正统计后独立校验仍退出 0，未重跑浏览器。

## 证据与复现

产物在忽略目录 `.runtime/pdf-production-2026-10-16/`，均保留独立源码、结果与日志：

- `probe-style-cost-r34.py`、`font-r34-style-*`：局部诊断；`build-font-runtime-r34.py`、`font-metrics-runtime-r34.js`、`test-font-scope-r34.cjs`、`r34-font-scope.log`：候选及合成边界。
- `check-font-style-r34.py`、`check-font-css-source-r34.py`、`verify-font-styles-r34.py`、`r34-style-verification.json`：新增红绿及源替换；`r34-selector-audit.md` 是静态构造。
- `inspect-font-metrics-r34.py`、`font-r34-v4-quality`、`font-r34-v4-control-a`、`font-r34-v4-cache-a`：三个整批场景；`verify-font-metrics-r34.py`、`r34-v4-final-verification.json`、同名日志：最终独立核对。

运行样式夹具用 `check-font-style-r34.py --name font-r34-CASE --runtime font-metrics-runtime-r34.js --case CASE`；源替换用 `check-font-css-source-r34.py --name font-r34-NAME --runtime font-metrics-runtime-r34.js --phase loaded|sync`。整批入口及开关沿用前报告，替换为对应脚本与上述场景名；独立核对用 `verify-font-metrics-r34.py --output REPORT.json font-r32-control-a RUN...`。旧候选新增红例退出 1；新候选、40 项合成和最终独立校验退出 0。原报告与日志保留。

本次文档检查首次因合并报告超长退出 1，拆分而未放宽政策；最终结果见 `r34-docs-final-retry.log`。取舍由[候选笔记](../../.agents/notes/proposed/storage/2026-10-17-pdf-font-metrics-cache.md)维护。
