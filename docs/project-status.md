# 发布状态与待办

证据核对日期：2026-10-10。

当前适合小范围实际试用，尚未达到正式生产发布条件。本页区分源码、产物与实际验收；精确成绩、版本、数据数量与失败日志由对应报告维护，不在此累计各轮样本。

## 可核验的交付

安装、构建、共享源码和Web交付分别判断。其后修复已更新共享源码及本地Web，不能据应用版本号推断现有APK/iOS产物包含这些改动；内部签名不代表发行准备完成。

| 范围 | 已有证据与限制 | 报告入口 |
| --- | --- | --- |
| Android 构建与安装 | 已记录安装0.1.76/code77，同签名覆盖升级并保留记录；后续已记录构建0.1.78/code79。补图编辑、批量重试及非流式等再后续修复尚未重新打包/安装，真机模型路径需另验 | [安装记录](postmortem/2026-10-06-exam-skills-and-android-install.md)、[包构建](postmortem/2026-10-09-direct-answer-review.md)、[后续共享修复](postmortem/2026-10-09-batch-retry-and-timeouts.md) |
| 真机交互与切题 | 上次完整交互验收为0.1.73，包含相机、分享、键盘、后台及切题；仍有系统慢帧，旧包观测不能代替新源码验收 | [安装](postmortem/2026-10-04-android-install.md)、[切题画面](postmortem/2026-10-04-android-install.md#切题与画面)，[早期修复过程](DEVICE_ACCEPTANCE_0_1_69.md) |
| 本地存储 | 独立原生探针验证容量故障、强杀及大备份；坏补图恢复和坏记录旁普通合并有定向证据。组合损坏边界及跨进程限制见当前[存储说明](subsystems/storage.md) | [原生存储](postmortem/2026-10-03-android-storage.md)，[恢复修复](postmortem/2026-10-05-recovery-repair.md) |
| 题型与学科呈现 | 题型、长文追问、同题补图、写作/化学/数学图已实现；既有小样本仍有核验超时，不证明完整准确率 | [考试增强](postmortem/2026-10-04-exam-enhancement.md)，[学科呈现](postmortem/2026-10-04-subject-presentation.md) |
| 生物与学生资源 | 已用用户题图真实批测并逐题判断；发现关键转录错误仍被PASS放行、正确答案因展示裁片判FAIL及超时。单套题与重拍不能证明泛化准确率 | [最新逐题判断](postmortem/2026-10-09-biology-batch-answers.md)、[最新批测](postmortem/2026-10-09-biology-batch-acceptance.md)、[前轮复核](postmortem/2026-10-06-biology-batch-review.md)、[前轮修复](postmortem/2026-10-06-biology-reliability-fixes.md) |
| 官网真实评测与后续修复 | 主机生产Agent完成在线、归档和Guide评测；收尾、格式窗口和独立选项比较已修复并定向复测，仍有生物/TARA错误与超时；未代表手机逐卷通过 | [全量](postmortem/2026-10-06-official-exam-suite.md)、[分科分卷](postmortem/2026-10-06-official-exam-suite-by-subject.md)、[问题分析](postmortem/2026-10-06-official-exam-suite-analysis.md)、[后续修复](postmortem/2026-10-07-exam-reliability-repair.md) |
| 核验覆盖 | 逐题/逐小问覆盖与结构窗口已有回归；有效PASS仍可能与官方不符 | [核验增强](postmortem/2026-10-05-verification-enhancement.md) |
| 当前模型服务 | 三组当前配置完成真实连接、8路短并发及合成题流程，包含受控判错后的真实备用接手；短测通过不消除旧日志的长尾等待，同一供应商三组不构成跨供应商容灾 | [2026-10-10稳定性](postmortem/2026-10-10-model-service-stability.md) |
| Web | 本地3100已交付补图增删、失败重试、阶段延长、非流式及可编辑环境模型设置和整组预设；三道已授权生物照片完成候选模型比较，仍有正确选项对应FAIL。步骤/知识点生成与缓存已有独立证据；少量实图不代表全科准确率，公网部署未验 | [重试与模型对比](postmortem/2026-10-09-batch-retry-and-timeouts.md)、[图片编辑](postmortem/2026-10-09-correction-images.md)、[学习与耗时](postmortem/2026-10-09-learning-and-latency.md)、[设置编辑](postmortem/2026-10-10-web-settings-editor.md)、[整组预设](postmortem/2026-10-10-web-model-presets.md) |
| iOS | 2026-10-08已有原生模拟器验收；10月9日Mac SSH可达但认证失败，后续共享逻辑修复尚未完成新Xcode编译/原生验收。真机签名、联网及发行未验 | [模拟器证据](postmortem/2026-10-08-ios-simulator.md)、[连接限制](postmortem/2026-10-08-exam-flow-review.md)、[后续源码范围](postmortem/2026-10-09-batch-retry-and-timeouts.md) |
| 工程管理与CI | 文档分层、本地检查和CI配置已建立；远端执行与分支保护未完成 | [管理修正](postmortem/2026-10-04-project-practice.md)，[管理改造](postmortem/2026-10-03-project-management.md) |

较早的[模型主测](UAT_UK_LIVE_EVAL_2026_10_02.md)、[可靠性复测](MODEL_RELIABILITY_2026_10_03.md)与[页面复核](postmortem/2026-10-03-ui-production.md)保留历史观察；最新报告不覆盖其中的原始失败。

## 待完成

| 优先级 | 工作 | 完成所需证据 |
| --- | --- | --- |
| P1 | 存储极端条件补充 | 整机文件系统ENOSPC、低内存设备与500题规模；已验证的SQLite故障和大文件流程见原生存储报告，不等同这些环境 |
| P1 | 正式签名与发行 | 确定发布渠道和签名保管，完成构建/升级/备份恢复验收 |
| P1 | 依赖漏洞修复 | [2026-10-08审计](postmortem/2026-10-08-ios-simulator.md)仍有2 critical、5 high、1 low；按实际消费路径应用可用修复并验证兼容性。此前[复审](postmortem/2026-10-05-recovery-repair.md)只代表当时版本 |
| P1 | 核验残余问题与设备交付 | 按[生物批测](postmortem/2026-10-09-biology-batch-acceptance.md)及[模型对比](postmortem/2026-10-09-batch-retry-and-timeouts.md)复核关键转录漏检、正确选项FAIL与超时；扩大独立题集。补图编辑、重试及传输修复需重新打包，并分别验证Android升级和iOS原生路径 |
| P2 | 组合损坏下普通导入 | 坏题元数据与Web非字符串摘要并存时冲突检查会中止；先补隔离复现，再修复并验证I/O仍拒绝，见[存储边界](subsystems/storage.md#备份与恢复) |
| P2 | Web部署与浏览器兼容 | 正式HTTPS来源上的Web Locks、相机、保存和实际模型CORS；Firefox/Safari及多设备验证 |
| P2 | CI远端执行与分支保护 | 提交后工作流实际通过；仓库保护规则在外部平台配置 |
| P2 | 更多设备与长文性能 | 多机型、长答案、历史规模及内存/逐帧记录；跟进[旧包慢帧限制](postmortem/2026-10-04-android-install.md#未验证项与剩余风险) |

新增验证放 `postmortem/`，本页只更新范围与证据入口。未执行项不得改成完成；iOS原生、隔离Python和保留服务公网验收按各自范围推进。
