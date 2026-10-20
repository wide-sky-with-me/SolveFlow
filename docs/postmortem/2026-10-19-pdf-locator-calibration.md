# 定位器校准与PDF准入热点

日期：2026-10-19。范围：[前轮交互基线](2026-10-19-pdf-clean-interaction.md)的同一27题已准备批次、同一完整构建；Linux、Chrome154.0.8037.97，桌面1440×1000，CDP四倍CPU降速。无产品实现、画质、容量或截止变更，未部署。

结论：缩小查询范围确实减少空闲定位链路开销，但没有明显消除活跃导出的早段观察等待。独立短窗诊断进一步指向队列准入中的全量快照校验；下一步优先审查其重复校验边界，而不是凭静态怀疑先改预览。整体生产流畅验收仍开放。

## 变更与处理

忽略目录新增 `inspect-locator-interaction-r80.py`，从父轮驱动精确派生且反向还原核对。仅增加scope、独立空闲校准分支及结果元数据；所有原生对照用同一脚本，实际命令串行page/footer/page，分别创建新浏览器和上下文。父轮冻结、当前源码及实际请求的完整构建哈希均核对。

空闲校准对当前唯一的“下载 PDF”按钮做全页/页脚/全页三个块，每块五次完整Locator.bounding_box调用；两种定位保留button、精确名称和隐藏过滤，并确认唯一匹配及同坐标。计时含元素解析、通信、排队、几何读取及释放，不是纯角色查询。页脚CSS根查找仍有成本；不把它说成整个调用只访问页脚节点。

scope也改变取消出现轮询和恢复按钮断言，可能改变取消所在导出阶段。原生对照仅测试驱动策略与功能，不是固定产品阶段的性能A/B；未额外证明忙碌取消按钮的全局唯一性。不从忙碌窗口扣除空闲差值。

原生对照保留无额外运行时探针、原型补丁、CPU采样、强制GC或窗口内截图/像素回读的边界。另一个新上下文仅做CPU诊断：投递前启动Profiler，观察取消入口后请求停止，可能含停止调度尾部。其时钟值不进入无探针或生产成绩。

## 验证结果

所有数值均为本次样本的驱动观察，不是首绘、INP、输入队列或事务提交时刻。空闲每块五次是同上下文重复，不是独立上下文分布：

| 空闲块 | bounding_box中位数/ms |
| --- | ---: |
| 全页A1 | 23.864 |
| 页脚B1 | 14.461 |
| 全页A2 | 25.869 |

空闲DOM有5480个元素，预览子树4406、页脚后代8；数量本身不证明隐藏状态或贡献比例。另在诊断上下文窗口外补测：预览details.open=false、原生checkVisibility=false、Playwright is_visible=false，clientRects仍为1。该数据不回填原空闲上下文，也不等同忙碌DOM实测。

| 原生对照 | 观察取消入口/ms | 取消坐标读取/ms | 取消投递至UI恢复/ms | 原地重导出下载/ms |
| --- | ---: | ---: | ---: | ---: |
| 全页A1 | 654.0 | 324.3 | 272.6 | 13901.7 |
| 页脚B1 | 657.9 | 327.2 | 226.2 | 14157.0 |
| 全页A2 | 672.3 | 311.8 | 258.5 | 13541.7 |

三次取消均cancelled且无文件、sizes或下载；三次原地重试均成功。三份PDF共81页A4，逐页JPEG与规范基准字节一致、每份27张图不重复，下载与落盘文件SHA一致。题目和准备缓存前后指纹相同，模型尝试、外部请求和页面错误为零；各上下文与浏览器关闭，结束仅余主框架。不声称新增整份PDF RGB或实体设备证据。

独立诊断采704个样本，采样区间约1.416秒，非干净延迟基线。submit包含591次命中，questionsForBatchQuestionPrint包含407次，通用Zod正则检查自身368次；包含计数嵌套，不作加总或函数耗时解释。代表栈和未改写构建片段确认 `submit → questionsForBatchQuestionPrint → BatchPrintSnapshotSchema.parse → $ZodCheckRegex`。尚未分离submit内两次计数调用或具体数据字段，不把其余submit自命中直接归给structuredClone。源码见[准入](../../apps/mobile/src/local/web-export-tasks.ts)和[题目投影](../../packages/client/src/batch-print-variants.ts)。

实际诊断解释器 `/usr/bin/python` 为3.12.3，Python Playwright为1.58.0；不拿仓库Node依赖版本替代实际执行版本。该上下文只验证取消及画像，不生成第四份PDF。诊断和干净回放分开验证、封存。

证据根 `.runtime/pdf-production-2026-10-16/`：空闲目录 `integrated-r51-r80-idle-cpu4-v1`；原生目录按顺序为 `integrated-r51-r80-page-a1-cpu4-v1`、`integrated-r51-r80-footer-b1-cpu4-v1`、`integrated-r51-r80-page-a2-cpu4-v1`。CLI分别使用 `--cpu 4 --scope page`、`--cpu 4 --scope footer`、`--cpu 4 --scope page`；空闲使用 `--cpu 4 --calibration-only`。诊断使用独立 `inspect-entry-profile-r80.py --name integrated-r51-r80-entry-profile-cpu4-v1 --cpu 4 --scope footer`，均退出0。

`verify-clean-interaction-r79.py` 的本轮独立成品验证、`verify-locator-interaction-r80.py` 和 `analyze-entry-profile-r80.py` 均退出0。结果为 `r80-native-base-verification.json`、`r80-locator-interaction-verification.json`、`r80-entry-profile-analysis.json`；代表栈/构建片段见 `r80-profile-hotstack.json`，只读独立审查边界见 `r80-review-notes.md`。父轮121份冻结文件、74份当前源码及祖父轮289份冻结证据无漂移；产品未改，不重跑全套测试或构建。文档/差异检查和封存分别见 `r80-docs-check.log`、`r80-diff-check.log`、`r80-evidence-manifest.json`、`r80-final-integrity.json`。

## 未验证项与剩余风险

下一处收敛到准入计数触发的重复全量校验；优化需保留输入校验、页数错误优先、容量计量与快照捕获同一同步段、取消优先及迟到隔离。单份带剖析器画像只是定位线索，不外推CPU占比、首绘或所有语料主因，也不据此添加memo/yield。

未新增未准备数据、窄屏、跨浏览器、实体设备、连续长负载和字体/晚图片故障矩阵。未提交、推送、部署或重放付费调用；不以通过本轮校准宣布生产完成。
