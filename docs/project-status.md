# 发布状态与待办

核对：2026-11-05。试用中，未达生产条件；原生沿用原验收日期，成绩不跨版本、设备或重复样本累计。

## 本机与远程版本

| 环境 | 最近确认的版本与范围 | 证据 |
| --- | --- | --- |
| 本机 Web 3100 | 保留10/29图片工作台构建，入口正常；本轮Mac发布未替换本机资源 | [工作台与草稿](postmortem/2026-10-29-ui-workbench-repair.md) |
| 远程 Mac Web 3131 | main工作树`20261104-camera-175615`，含相机/HEIC大图修复；32/32和模型配置保留 | [输入与部署](postmortem/2026-11-04-iphone-camera-practice.md) |
| 腾讯云中心考试 | 前端`20261105-student-labels`；HTTP保留，部分网络受阻 | [发布](postmortem/2026-11-05-student-answer-labels.md)、[限制](postmortem/2026-11-05-http-ip-trial.md) |
| Android / iOS | 工作区0.1.82/build83，补齐原生取消信号；Android已在隔离模拟器验证插入、共享补图、多份PDF及系统保存/分享。iOS三项模拟器XCTest及真机目标编译通过，IPA未签名；真机与发行另验 | [模拟器与修复](postmortem/2026-10-30-android-emulator.md)、[前轮PDF](postmortem/2026-10-30-native-pdf.md) |

运行见[Web指南](cookbook/local-web.md)，历史见[问题导航](postmortem/README.md#按问题查报告)。

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

iPhone大图预览、公网任务恢复及原生iOS后台收尾已有Chrome/WebKit、隔离中心、Mac编译和2项iOS模拟器证据，见[验收](postmortem/2026-11-03-iphone-input-background.md)。真机后台/低内存未验，Mac及原生本轮未更新。

上传取消、图片及并发见[边界复查](postmortem/2026-11-03-iphone-review.md)；弹窗与流程见[视觉验收](postmortem/2026-11-03-functional-visual.md)；离线停止及期限见[深度复查](postmortem/2026-11-03-deep-review.md)。无安排临时拍题见[输入验收](postmortem/2026-11-04-iphone-camera-practice.md)，定时/不限时及双方结束见[计时验收](postmortem/2026-11-04-exam-timing.md)，均已发布腾讯云。分配改进及计时提醒偶发延迟见[验收](postmortem/2026-11-04-exam-allocations.md)。

`feat/public-photo-web`已新增独立中心考试服务、固定题位、持久红色问题和老师介入。提醒、题型/官方模板及人工确认在隔离PG和Chrome使用假模型验证，见[核验报告](postmortem/2026-11-03-exam-reviews.md)；自由跳题/跳模块、位置跟踪见[导航报告](postmortem/2026-11-03-exam-navigation.md)。过期互斥、保存、登录、恢复已修正，见[边界回归](postmortem/2026-11-03-exam-review-fixes.md)；人工答案、最近答案、错误归属、开考和焦点样式见[界面修复](postmortem/2026-11-03-exam-ui-fixes.md)。题目总览、按题处理队列及可定位答案的持久解决通知见[问题闭环](postmortem/2026-11-03-exam-attention.md)。控制台图表、大屏及14次合成题真实模型请求见[实测](postmortem/2026-11-03-exam-console-live.md)。已拍题的教师AI/手动选项、并发保护和学生同步见[教师作答](postmortem/2026-11-03-teacher-answer.md)。详情布局见[布局验收](postmortem/2026-11-03-exam-dialog-layout.md)，看板/大屏见[本轮](postmortem/2026-11-04-home-layout.md)，分页与选择框见[列表验收](postmortem/2026-11-04-managed-list-pagination.md)。单机Docker/公网验收见上表；真实题图、COS、负载、备份恢复及目标分数规划仍待验。

本地[六项修复](postmortem/2026-11-05-workflow-repairs.md)待发布。

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

行为见[子系统导航](README.md#按任务阅读)；历史验收日期、失败与未验项保留。
