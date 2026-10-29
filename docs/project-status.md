# 发布状态与待办

核对：2026-10-29。

试用中，未达生产条件；样本不累计。

[本机验收](postmortem/2026-10-28-batch-controls-preflight.md)。

## 可核验的交付

源码不代表原生升级；内部签名未验发行。

| 范围 | 已有证据与限制 | 报告入口 |
| --- | --- | --- |
| Android 构建与安装 | 已构建0.1.79/code80，含ACT共享修复，同前包证书、包内DOM检查通过；不含后述功能审查修复，安装未验。既有安装证据为0.1.76/code77，真机升级与模型路径另验 | [新包与复核](postmortem/2026-10-20-act-delivery.md)、[安装记录](postmortem/2026-10-06-exam-skills-and-android-install.md) |
| 真机交互与切题 | 上次完整交互验收为0.1.73，包含相机、分享、键盘、后台及切题；仍有系统慢帧，旧包观测不能代替新源码验收 | [安装](postmortem/2026-10-04-android-install.md)、[切题画面](postmortem/2026-10-04-android-install.md#切题与画面)，[早期修复过程](DEVICE_ACCEPTANCE_0_1_69.md) |
| 本地存储 | 独立原生探针验证容量故障、强杀及大备份；坏补图恢复和坏记录旁普通合并有定向证据。组合损坏边界及跨进程限制见当前[存储说明](subsystems/storage.md) | [原生存储](postmortem/2026-10-03-android-storage.md)，[恢复修复](postmortem/2026-10-05-recovery-repair.md) |
| 题型与学科呈现 | 题型/补图/长文已实现；ACT补双篇方法和源版本回归；全科真实质量与真机另验 | [考试增强](postmortem/2026-10-04-exam-enhancement.md)、[学科呈现](postmortem/2026-10-04-subject-presentation.md)、[ACT核查](postmortem/2026-10-20-act-completeness.md) |
| 生物与学生资源 | 用户题图批测留有转录漏检、裁片误判及超时。六例清晰图复测、修正测试入口后仍有错答PASS与截断；正确选项不等于完整候选无转录错误。同套题不证明泛化准确率 | [新复测](postmortem/2026-10-20-act-delivery.md)、[逐题判断](postmortem/2026-10-09-biology-batch-answers.md)、[原图批测](postmortem/2026-10-09-biology-batch-acceptance.md) |
| 官网真实评测与后续修复 | 主机生产Agent完成在线、归档和Guide评测；收尾、格式窗口和独立选项比较已修复并定向复测，仍有生物/TARA错误与超时；未代表手机逐卷通过 | [全量](postmortem/2026-10-06-official-exam-suite.md)、[分科分卷](postmortem/2026-10-06-official-exam-suite-by-subject.md)、[问题分析](postmortem/2026-10-06-official-exam-suite-analysis.md)、[后续修复](postmortem/2026-10-07-exam-reliability-repair.md) |
| 核验覆盖 | 逐题/逐小问覆盖与结构窗口已有回归；有效PASS仍可能与官方不符 | [核验增强](postmortem/2026-10-05-verification-enhancement.md) |
| 功能逻辑审查 | 多题局部核验不再误标整图通过，辅助示例不再新增题页或错移追问；旧摘要自动重建。单元与隔离Web通过，APK待更新 | [功能审查](postmortem/2026-10-20-functional-logic-review.md) |
| 当前模型服务 | 三组当前配置完成真实连接、8路短并发及合成题流程，包含受控判错后的真实备用接手；短测通过不消除旧日志的长尾等待，同一供应商三组不构成跨供应商容灾 | [2026-10-10稳定性](postmortem/2026-10-10-model-service-stability.md) |
| Web | 本地3100支持补图增删、失败重试、阶段延长、非流式、环境模型编辑与整组预设；三道生物照片已授权比较候选模型，仍有正确选项对应FAIL。步骤/知识点生成及缓存已验；少量实图不代表全科准确率，公网部署未验 | [重试与模型对比](postmortem/2026-10-09-batch-retry-and-timeouts.md)、[图片编辑](postmortem/2026-10-09-correction-images.md)、[学习与耗时](postmortem/2026-10-09-learning-and-latency.md)、[设置编辑](postmortem/2026-10-10-web-settings-editor.md)、[整组预设](postmortem/2026-10-10-web-model-presets.md) |
| Web 新增功能 | PDF/单页/副本ZIP/后台/持久整理及初读/缓存重试、纯文字已验；图示/草稿/裁框/分行/容量/恢复已验，浅灰已修。导出/取消及准入/重复解析/JPEG/挂载/订阅已优化；入队/写入/派发/补存取消与身份已修；补存不重绘、错误定位、跨任务取消及编码交接已验。保真通过；候选隔离，流畅未验；源题、长负载及原生未验，Mac旧证据 | [浏览器时序](postmortem/2026-10-18-pdf-native-timeline.md)、[资源截止](postmortem/2026-10-18-pdf-resource-handoff.md)、[源布局](postmortem/2026-10-18-pdf-source-suspend.md)、[持久整理](postmortem/2026-10-14-persistent-paper-preparation.md)、[入口](postmortem/2026-10-14-pdf-preparation-header.md)、[单页边界](postmortem/2026-10-15-pdf-render-scope.md)、[图示摆正](postmortem/2026-10-15-pdf-image-deskew.md)、[纸面](postmortem/2026-10-15-pdf-paper-enhancement.md)、[浅灰保真](postmortem/2026-10-17-pdf-paper-contrast.md)、[陈述与容量](postmortem/2026-10-15-pdf-statement-capacity.md)、[失败反馈](postmortem/2026-10-15-pdf-failure-feedback.md)、[成品恢复](postmortem/2026-10-15-pdf-inline-save-retry.md)、[绘图输入](postmortem/2026-10-17-pdf-firstpage-draw-inputs.md)、[四角校样](postmortem/2026-10-15-pdf-image-perspective.md)、[草稿](postmortem/2026-10-17-pdf-image-drafts.md)、[校样](postmortem/2026-10-17-pdf-canonical-geometry.md)、[图像取消](postmortem/2026-10-17-pdf-image-cancellation.md)、[边界](postmortem/2026-10-16-pdf-perspective-boundary.md)、[数量](postmortem/2026-10-16-pdf-copy-quantities.md)、[交互](postmortem/2026-10-16-pdf-interaction-budget.md)、[投影取消](postmortem/2026-10-16-pdf-snapshot-projection.md)、[异步编码](postmortem/2026-10-16-pdf-async-jpeg.md)、[编码交接](postmortem/2026-10-17-pdf-codec-cancellation.md)、[并发挂载](postmortem/2026-10-16-pdf-concurrent-mount.md)、[准入分段](postmortem/2026-10-16-pdf-admission-yield.md)、[写入取消](postmortem/2026-10-17-pdf-admission-cancellation.md)、[派发与补存](postmortem/2026-10-17-pdf-dispatch-cancellation.md)、[取消与恢复](postmortem/2026-10-17-pdf-cancel-ui-recovery.md)、[渲染](postmortem/2026-10-17-pdf-render-candidates.md)、[让步](postmortem/2026-10-17-pdf-cooperative-yield.md) |
| iOS | 2026-10-08已有原生模拟器验收；ACT应用源码快照已备，用户本轮暂缓Mac验收，尚未完成新原生编译。真机签名、联网及发行未验 | [模拟器证据](postmortem/2026-10-08-ios-simulator.md)、[交付准备](postmortem/2026-10-20-act-delivery.md) |
| 工程管理与CI | 文档分层及本地CI检查已有；远端CI与分支保护未完成 | [管理修正](postmortem/2026-10-04-project-practice.md)，[管理改造](postmortem/2026-10-03-project-management.md) |

PDF [语料](postmortem/2026-10-19-pdf-biology-corpus.md)、[样式](postmortem/2026-10-18-pdf-body-has-scope.md)、[时限](postmortem/2026-10-21-pdf-copy-timeout.md)、[小修](postmortem/2026-10-21-small-issues-review.md)、[Mac入口](postmortem/2026-10-23-wifi-web-entry.md)。[识别改进](postmortem/2026-10-26-local-image-review.md)、[工作台](postmortem/2026-10-27-batch-material-workbench.md)、[批次控制与预检](postmortem/2026-10-28-batch-controls-preflight.md)及依赖修复已同步[Mac新版](postmortem/2026-10-29-mac-web-update.md)，默认32/32；真实模型与原生另验。

旧[模型主测](UAT_UK_LIVE_EVAL_2026_10_02.md)、[可靠性复测](MODEL_RELIABILITY_2026_10_03.md)、[页面复核](postmortem/2026-10-03-ui-production.md)为当时证据。

## 待完成

| 优先级 | 工作 | 完成所需证据 |
| --- | --- | --- |
| P1 | 存储极端条件补充 | 整机文件系统ENOSPC、低内存设备与500题规模；已验证的SQLite故障和大文件流程见原生存储报告，不等同这些环境 |
| P1 | 正式签名与发行 | 确定发布渠道和签名保管，完成构建/升级/备份恢复验收 |
| P1 | 依赖漏洞修复 | [10-29修复](postmortem/2026-10-29-dependency-hardening.md)消除34项，剩deepmerge一项low已加本地补丁；上游未发布，原始审计仍失败，CI不放宽，非生产放行 |
| P1 | 核验残余问题与设备交付 | 按[最新复测](postmortem/2026-10-20-act-delivery.md)处理错答PASS与输出截断，复核实际Web校验组并扩大独立题集；功能审查修复尚需重新打包、升级及真机验证，iOS原生按用户要求暂缓 |
| P2 | 组合损坏下普通导入 | 坏题元数据与Web非字符串摘要并存时冲突检查会中止；先补隔离复现，再修复并验证I/O仍拒绝，见[存储边界](subsystems/storage.md#备份与恢复) |
| P2 | Web部署与浏览器兼容 | 正式HTTPS来源上的Web Locks、相机、保存和实际模型CORS；Firefox/Safari及多设备验证 |
| P2 | CI远端执行与分支保护 | 提交后工作流实际通过；仓库保护规则在外部平台配置 |
| P2 | 更多设备与长文性能 | 多机型、长文、历史规模；内存/逐帧见[旧限制](postmortem/2026-10-04-android-install.md#未验证项与剩余风险)、[导入](postmortem/2026-10-23-batch-import-optimization.md) |

新证据归 `postmortem/`；未验不标完成；iOS原生、隔离Python及服务公网分别验收。
