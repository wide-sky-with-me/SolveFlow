# 发布状态与待办

核对：2026-11-07。试用中，未达生产条件；成绩不跨版本、设备或重复样本累计。

## 本机与远程版本

| 环境 | 版本与范围 | 证据 |
| --- | --- | --- |
| 本机 Web 3100 | 保留10/29工作台构建；本轮只改API易私有预设，服务未启动 | [工作台与草稿](postmortem/2026-10-29-ui-workbench-repair.md) |
| 远程 Mac Web 3131 | main工作树`20261104-camera-175615`，含相机/HEIC大图修复；32/32和模型配置保留 | [输入与部署](postmortem/2026-11-04-iphone-camera-practice.md) |
| 腾讯云中心考试 | `20261106-model-services`，两API/worker/events与schema8；HTTP试用API内存512MiB | [发布](postmortem/2026-11-06-model-services.md)、[限制](postmortem/2026-11-05-http-ip-trial.md) |
| Android / iOS | 工作区0.1.82/build83，补齐原生取消信号；Android已在隔离模拟器验证插入、共享补图、多份PDF及系统保存/分享。iOS三项模拟器XCTest及真机目标编译通过，IPA未签名；真机与发行另验 | [模拟器与修复](postmortem/2026-10-30-android-emulator.md)、[前轮PDF](postmortem/2026-10-30-native-pdf.md) |

入口：[Web](cookbook/local-web.md)、[报告](postmortem/README.md#按问题查报告)。

## 可核验的交付

| 范围 | 已有证据与限制 | 报告入口 |
| --- | --- | --- |
| 本地工作流与UI | 重试不新增失败空题，补图保留原题号，局部删除不阻塞其他批次；导入和旧编辑统一缩略图，单图保存失败保留裁剪。对应单元、隔离Web及实际PDF见各报告；未代表原生或真实模型验收 | [工作流](postmortem/2026-10-29-workflow-isolation-repair.md)、[图片工作台](postmortem/2026-10-29-ui-workbench-repair.md) |
| 当前模型服务 | 答题/校验各32路合成短请求，80/80成功，无429或超时；未改本机并发偏好，不代表真实ACT题图或持续负载容量。备用接手仍属旧流程，同供应商不构成容灾 | [32路实测](postmortem/2026-10-29-model-concurrency-32.md)、[旧流程](postmortem/2026-10-10-model-service-stability.md) |
| PDF导出 | 原生快速原文已接入多份错题数/备注、答案表、高亮、书签、补图和文件交接；Android/iOS模拟器实际PDF/ZIP通过。网页其他版式、源题长负载和Firefox/Safari分别验收 | [原生PDF](postmortem/2026-10-30-native-pdf.md)、[Web保存恢复](postmortem/2026-10-24-export-save-recovery.md)、[远程复核](postmortem/2026-10-29-mac-web-update.md) |
| ACT识别与答题 | 最新四科实拍工作流与PDF已实测，仍有表格误读、材料/裁片核验疑点及偶发网络失败；校验通过或选项一致不等于完整转录和正确率 | [本轮实测](postmortem/2026-10-30-act-workflow-live.md)、[转录](postmortem/2026-10-23-act-source-capture.md)、[低质材料](postmortem/2026-10-26-act-material-diagnosis.md) |
| 题型与功能逻辑 | 多题局部校验不误标整图通过，辅助示例不新增题页，旧摘要可重建；题型、补图、长文及学科结构有离线/浏览器证据，新APK待安装验证 | [功能审查](postmortem/2026-10-20-functional-logic-review.md)、[学科呈现](postmortem/2026-10-04-subject-presentation.md) |
| 真实评测与核验 | 仍留错答PASS、正确选项被判FAIL、转录漏检及截断，以及生物/TARA错答与超时；清晰图复测不代表全部修复。官方播放器与主机生产Agent成绩不代替设备逐卷验收 | [分科分析](postmortem/2026-10-06-official-exam-suite-analysis.md)、[后续修复](postmortem/2026-10-07-exam-reliability-repair.md)、[最新交付复测](postmortem/2026-10-20-act-delivery.md) |
| 本地存储 | 原生隔离探针覆盖容量故障、强杀、大备份；坏补图恢复和坏记录旁普通合并有定向证据。组合损坏与跨进程限制归当前存储说明 | [原生存储](postmortem/2026-10-03-android-storage.md)、[恢复修复](postmortem/2026-10-05-recovery-repair.md)、[当前边界](subsystems/storage.md) |
| Android构建与交互 | 0.1.82/code83同证书APK已在API35 ARM64模拟器覆盖安装，PDF、局部重答、插入顺延、系统保存/分享及重启读取通过；未安装真机。真机安装仍为0.1.76/code77，旧完整交互仍有慢帧 | [本轮模拟器](postmortem/2026-10-30-android-emulator.md)、[真机安装](postmortem/2026-10-06-exam-skills-and-android-install.md)、[旧交互与帧](postmortem/2026-10-04-android-install.md) |
| iOS | 0.1.82/build83三项模拟器XCTest、SQLite和实际文件通过，含PDF、分享、相册/补图/裁剪、设置与横屏；真机目标Release编译通过，IPA未签名；真机、真实联网和发行未验 | [本轮模拟器](postmortem/2026-10-30-android-emulator.md)、[前轮原生PDF](postmortem/2026-10-30-native-pdf.md) |
| 依赖与工程管理 | 34项依赖版本告警已消除，deepmerge本地补丁保留但原始审计仍失败；CI不放宽。文档分层和本地检查已有，远端CI及分支保护未完成 | [依赖修复](postmortem/2026-10-29-dependency-hardening.md)、[管理修正](postmortem/2026-10-04-project-practice.md) |

## 中心考试分支

本地核对：2026-11-08。远程版本沿最近发布记录，本轮没有连接或替换腾讯云/Mac；本地测试不代表线上已更新。

| 范围 | 当前记录与限制 | 证据 |
| --- | --- | --- |
| 腾讯云最近发布 | 双服务方案、顶栏重答和五态配色已发布，版本见上表；仍采用HTTP临时入口 | [模型方案发布](postmortem/2026-11-06-model-services.md)、[HTTP试用](postmortem/2026-11-05-http-ip-trial.md) |
| 本地未发布 | 三层场次、两级改名/归档/成员汇总、教师独立消息和考试记录分类已实现，要求schema11；选项及填空答案预览同步调整 | [场次与消息](postmortem/2026-11-07-exam-history-messages-events.md)、[答案预览](postmortem/2026-11-07-non-choice-answer-values.md) |
| 本地逻辑与界面复核 | 归档、保存版本、消息重试及临时拍题取消已补查；统计整合为单一首页。明暗主题、窄屏、焦点与动效有合成浏览器证据，未代表iPhone真机 | [逻辑巡查](postmortem/2026-11-07-platform-logic-ui-audit.md)、[界面与动效](postmortem/2026-11-08-managed-ui-polish.md)、[看板整合](postmortem/2026-11-08-dashboard-consolidation.md) |
| 输入及计时历史验收 | HEIC、临时拍题、定时/不限时与双方结束已有发布记录；不能将旧版成绩累计为当前版本验收 | [相机与输入](postmortem/2026-11-04-iphone-camera-practice.md)、[考试计时](postmortem/2026-11-04-exam-timing.md) |
| 生产与真机缺口 | 真题质量、COS策略、持续负载、跨机恢复、目标分数规划及iPhone后台/低内存仍须独立验收 | [当前边界](subsystems/managed-exams.md#当前限制)、[iPhone验收边界](postmortem/2026-11-03-iphone-input-background.md) |

功能规则按[平台导航](subsystems/managed-exams.md#功能定位)进入所属页面，操作与升级归[指南](cookbook/managed-exams.md)，历史证据按[报告入口](postmortem/README.md#按问题查报告)和日期/关键词检索。

## 待完成

| 优先级 | 工作 | 完成所需证据 |
| --- | --- | --- |
| P1 | 存储极端条件补充 | 整机文件系统ENOSPC、低内存设备与500题规模；既有SQLite故障及大文件成绩不等同这些环境 |
| P1 | 正式签名与发行 | 确定渠道和签名保管，完成构建、升级、备份恢复验收 |
| P1 | 依赖审计收尾 | 核对deepmerge正式修复并移除本地补丁；原始审计通过前不宣称安全检查全绿 |
| P1 | 核验与设备交付 | 按最新复测处理错答PASS及输出截断，扩大独立题集；Android新包需真机验证，iOS需Apple签名及真机验收，模拟器范围见本轮报告 |
| P2 | 组合损坏下普通导入 | 坏题元数据与Web非字符串摘要并存时冲突检查会中止；补隔离复现并验证I/O仍拒绝，见[存储边界](subsystems/storage.md#备份与恢复) |
| P2 | Web部署与兼容 | Mac双入口与隔离Chrome已有验收；真实相机、模型CORS及Firefox/Safari仍需独立验证 |
| P2 | CI远端执行与保护 | 提交后工作流实际通过，并在外部平台配置分支保护 |
| P2 | 长负载与多设备性能 | 真实长题转录、持续32/32负载、手机大图导入及内存/逐帧验证，不用短请求压测代替 |

行为见[子系统](README.md#按任务阅读)。
