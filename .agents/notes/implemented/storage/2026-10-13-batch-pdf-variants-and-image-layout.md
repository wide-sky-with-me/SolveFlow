# 批次作答副本、图片识别与 PDF 下载

日期：2026-10-13。状态：implemented。范围：Web批次PDF。

## 背景

用户要求文字题只导文字、图示及图片选项从原图提取，并按每份指定的对错数生成多个文件。参考本机 EXamTwin 的 `assessment/paper_parsing.py`、`paper_worker.py`、`paper_vision.py`：文字与图片资产分离、绑定来源，缺图失败关闭；未引入其 MinerU 服务。题目整理触发及派生缓存后由[按需整理](2026-10-13-print-layout-cache.md)局部替代，其他范围继续有效。这部分补强[初版决定](2026-10-12-batch-pdf-export.md)，原本地快照与打印路径继续适用。

## 决定

[识别契约](../../../../packages/contracts/src/batch-print-layout.ts)绑定固定题目/图片标识，[Pi适配](../../../../packages/agent/src/pi/batch-print-layout.ts)用当前已配模型单次无工具识别，低置信或疑点保留全部源图；图框先按未旋转原图裁切，再扶正。只生成内存阅读副本，不接收模型URL或生成替代题图。

[作答规划](../../../../packages/client/src/batch-print-variants.ts)按用户指定的计数规则处理原红警告，保留源候选与 verified。变化必须对应实际选项/作答，减少原错误需人工参照；有界枚举不同错题组合，无合法调整则拒绝。

[导出界面](../../../../apps/mobile/src/components/batch-pdf-export.web.tsx)逐份预览，取消设置不应用草稿；[下载适配](../../../../apps/mobile/src/local/download-batch-pdfs.web.ts)每份按实际绘制DOM分页，本地生成全部文件后单次下载PDF或ZIP。[共享打印frame](../../../../apps/mobile/src/local/print-batch.web.ts)复用可信样式、图片/字体加载、长公式拟合及清理；DOM逐份创建，避免堆积多份base64副本。专用单题页范围由[单页绘制决定](2026-10-15-pdf-page-render-scope.md)细化，原始记录续页仍适用本决定。

依赖采用 `html2canvas@1.4.1`、`jspdf@4.2.1`、`fflate@0.8.3`，均MIT；用途分别为浏览器页图、PDF容器、ZIP。html2canvas成熟但版本较旧、CSS/字体测量有限，必须用实际克隆DOM分页；jsPDF由yWorks维护，fflate提供有界可终止打包。均在Web下载时动态加载，原生路径不引入。Metro额外下载chunk约202KB、420KB、173KB，另有共享及purify chunk；独立压缩适配及传递依赖gzip约367KB。core-js转移安装脚本显式禁用，未扩大生命周期执行许可。官方依据：[jsPDF](https://github.com/parallax/jsPDF)、[html2canvas](https://html2canvas.hertzen.com/configuration)、[fflate](https://github.com/101arrowz/fflate)。

## 放弃的方案

连续打开多个浏览器打印对话框不能保证获得规定数量和名称的文件。新增服务端Chromium会改变本地数据边界与运行责任。自行实现中文PDF字体/公式布局成本较高。第一版复用现有安全React排版并高清分页绘制，保留原打印功能用于可选中文字。

## 后果与限制

直接下载正文为页图，体积高于矢量文档，不能选择或搜索正文。只有显式AI整理会触发模型调用，实际识别准确率需真实样本另验。对错是导出配置的业务假定及参照结果，不是新的独立校验；原校验不会被改写。原生端与不完整作答的多份输出暂不支持。

## 验证

[契约回归](../../../../packages/contracts/src/batch-print-layout.test.ts)、[规划回归](../../../../packages/client/src/batch-print-variants.test.ts)、[浏览器回归](../../../../tests/mobile-e2e/batch-pdf-variants.spec.ts)覆盖引用、额度、实际作答、文件数量/格式与原记录保护。实际命令、失败和未验范围见[验收](../../../../docs/postmortem/2026-10-13-batch-pdf-enhancement.md)。
