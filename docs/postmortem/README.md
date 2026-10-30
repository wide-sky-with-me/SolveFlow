# 复盘与验收记录

这里保存带时间范围的事故和实际验证证据，文件用 `YYYY-MM-DD-<topic>.md` 命名，主题使用小写英文短横线，日期取验证开始日期。只在值得追溯的故障、发行或集中验收时新增，普通修改的测试结果可留在交付记录中。

## 按问题查报告

下表是主题入口，不是全部报告清单；表中日期属于原验收，不表示当前版本重新通过。当前交付范围统一看[发布状态](../project-status.md)，其他报告按文件日期或关键词搜索。

| 要追溯的问题 | 报告 |
| --- | --- |
| 官网样卷、归档及分科分卷结果 | [2026-10-06全量评测](2026-10-06-official-exam-suite.md)、[分科分卷](2026-10-06-official-exam-suite-by-subject.md)、[分析](2026-10-06-official-exam-suite-analysis.md) |
| 新分支TMUA全量、PDF回归与国庆对照 | [2026-10-13实际评测](2026-10-13-tmua-branch-evaluation.md) |
| 试卷式纯题、单页与多份作答ZIP | [试卷验收](2026-10-14-exam-style-pdf-export.md)、[持久整理](2026-10-14-persistent-paper-preparation.md)、[Windows校样](2026-10-14-windows-chrome-print-preparation.md)、[失败恢复](2026-10-15-pdf-failure-feedback.md) |
| PDF真实多份、资源边界与图示修正 | [真实批次导出](2026-10-15-pdf-export-acceptance.md)、[资源与裁图](2026-10-15-pdf-resource-guards.md)、[容量边界](2026-10-15-pdf-layout-capacity.md)、[四角校样](2026-10-15-pdf-image-perspective.md) |
| ACT完整识别、两轮一致性与低质量材料 | [转录修复](2026-10-23-act-source-capture.md)、[两轮结果](2026-10-24-act-english-consistency.md)、[材料诊断](2026-10-26-act-material-diagnosis.md) |
| 快速PDF答案表、书签及补图导出 | [ACT导出](2026-10-23-act-pdf.md)、[补图复现](2026-10-24-supplement-pdf-reproduction.md)、[保存恢复](2026-10-24-export-save-recovery.md) |
| 导入速度、插入编号和拖动顺序 | [预处理](2026-10-23-batch-import-optimization.md)、[拖动](2026-10-27-batch-import-drag.md)、[默认追加](2026-10-27-batch-append-default.md) |
| 重试后的空题、导入预览与缩略图性能 | [2026-10-29重试及预览修复](2026-10-29-workflow-repair.md) |
| 补图丢原题号、局部删除阻塞与运行中插入 | [2026-10-29任务隔离修复](2026-10-29-workflow-isolation-repair.md) |
| 裁剪保存失败丢草稿、旧工作台风格与原图读取 | [2026-10-29工作台修复](2026-10-29-ui-workbench-repair.md) |
| 共享补图、独立重答及弹窗交互 | [异步补图](2026-10-27-batch-material-workbench.md)、[缩略图](2026-10-27-material-thumbnail-controls.md)、[重答反馈](2026-10-27-batch-regeneration-feedback.md)、[提示真实计时](2026-10-27-material-notice-expiry.md) |
| 开发产物清理及代码、文档整理 | [2026-10-27清理](2026-10-27-development-cleanup.md) |
| 生物批次答案与核验问题 | [2026-10-09逐题判断](2026-10-09-biology-batch-answers.md)、[批测](2026-10-09-biology-batch-acceptance.md) |
| 答题/校验两队列与判错接手 | [2026-10-09队列修复](2026-10-09-independent-queues.md)、[直接核对](2026-10-09-direct-answer-review.md) |
| 失败题重试、超时和非流式模型对比 | [2026-10-09运行核查](2026-10-09-batch-retry-and-timeouts.md) |
| 短请求并发与真实备用接手 | [2026-10-29各32路压测](2026-10-29-model-concurrency-32.md)、[2026-10-10备用接手](2026-10-10-model-service-stability.md) |
| Mac发布范围及依赖审计剩余问题 | [2026-10-30部署](2026-10-30-mac-web-update.md)、[依赖修复](2026-10-29-dependency-hardening.md) |
| Web环境模型编辑、配置保存与设置布局 | [2026-10-10设置验收](2026-10-10-web-settings-editor.md)、[整组预设](2026-10-10-web-model-presets.md) |
| 批次删除、二次调整与单题误清空 | [2026-10-10批次管理修复](2026-10-10-batch-management.md) |
| 更正题干时增删图片及历史快照 | [2026-10-09图片编辑](2026-10-09-correction-images.md) |
| 步骤、知识点、公式与页面布局 | [2026-10-09学习与耗时](2026-10-09-learning-and-latency.md)、[公式](2026-10-09-knowledge-formulas.md)、[计时与历史](2026-10-09-overall-timer-and-history-ui.md) |
| 原生构建和设备交付 | [2026-10-06 Android安装](2026-10-06-exam-skills-and-android-install.md)、[2026-10-08 iOS模拟器](2026-10-08-ios-simulator.md)、[2026-10-09包构建](2026-10-09-direct-answer-review.md) |
| 0.1.80 Android包及iOS补图工作台原生验收 | [2026-10-29原生构建与交互](2026-10-29-native-adaptation.md) |
| 0.1.81原生快速PDF、多份ZIP及系统分享 | [2026-10-30原生PDF验收](2026-10-30-native-pdf.md) |
| Android隔离模拟器与原生取消信号 | [2026-10-30模拟器验收](2026-10-30-android-emulator.md) |

## 报告模板

以下为内容骨架；验证结果可按安装、交互、性能等实际范围增加三级标题，命令和证据也可单列。不适用的内容直接说明，不编造根因或验证成绩。

```md
# 具体问题或验收主题

日期：YYYY-MM-DD；跨日时写完整起止日期。

范围：对象、版本、环境及测试数据类型。

结论：实际通过/失败范围与主要限制。

## 变更与处理

问题、影响、根因或尚未查明之处、对应修改；纯验收说明测试对象。

## 验证结果

实际命令、结果/退出码、样本、证据位置、首次失败与复测。

## 未验证项与剩余风险

未执行的路径、结论边界与后续工作入口。
```

## 证据与后续维护

区分 mock、真实模型、浏览器、包内资源与真机；测试失败和复测都保留，重复执行不累计为新样本。没有查到退出码时不要推断为零；版本、数量和性能指标保留当时值。报告的日期是验证日期，格式整理不能把日期刷新成新的验收。

复盘可以叙述时间线；当前运行语义另更新 `subsystems/`，长期方案取舍另放 [Agent Notes](../../.agents/notes/README.md)，两者通过链接关联。原图、响应正文、密钥与日志大文件不进入 Git。

未冻结报告可以规范格式、补充后续证据链接；已冻结报告按 [历史资料政策](../archive/README.md) 保持原貌。新验证写新报告，当前已验证范围由 [发布状态](../project-status.md) 指向；不要把旧报告待办视为今日仍未处理，也不要回填后来成绩。
