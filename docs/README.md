# 文档入口

阅读 [架构](architecture.md) 了解当前系统，[开发流程](development.md) 开始工作，[测试规则](testing.md) 选择验收，[发布状态](project-status.md) 查看已验证范围与剩余工作。

## 按任务阅读

| 要解决的问题 | 入口 |
| --- | --- |
| AI 接手后从哪些代码和测试读起 | [任务定位与交接](cookbook/ai-development.md) |
| 本地Web怎样运行、使用.env或更新服务 | [Web操作指南](cookbook/local-web.md) |
| 设备怎样提交任务和保存密钥 | [设备运行](subsystems/device-runtime.md) |
| 本地任务锁、并发、取消和最终写入 | [生命周期](subsystems/local-run-lifecycle.md) |
| 一题多图、补图增删和历史答案证据 | [图片与版本](subsystems/local-run-lifecycle.md#材料与答案版本)、[存储格式](subsystems/storage.md#数据与事务) |
| 保存失败、损坏记录、备份恢复 | [本地存储](subsystems/storage.md) |
| Pi、工具、考试与独立校验 | [解题核心](subsystems/agent.md) |
| 超时、重试、流式/非流式及诊断 | [模型预算与传输](subsystems/model-transport.md) |
| 公式、图文、切题与原生绘制 | [阅读渲染](subsystems/rendering.md) |
| Hono、任务事务与 SSE | [保留服务路径](subsystems/legacy-server.md) |
| 怎样改动和留下决策 | [变更流程](cookbook/change-management.md) |
| 文档放哪里、怎样命名与编写 | [编写约定](cookbook/documentation.md) |
| 怎样构建与验收 Android | [操作步骤](cookbook/android-release.md) |
| 怎样在 Mac 构建与验收 iOS | [模拟器步骤](cookbook/ios-simulator.md) |
| 怎样验证存储满、强杀和大备份 | [隔离存储验收](cookbook/android-storage-acceptance.md) |
| 为什么采用某个方案 | [决策笔记规则](../.agents/notes/README.md)，再按目录/关键词查找 |
| 某次故障或验收发生了什么 | [按问题查报告](postmortem/README.md#按问题查报告)、[历史资料政策](archive/README.md) |

## 目录分工

| 位置 | 阅读目的 |
| --- | --- |
| 根README及本页 | 介绍与导航 |
| `architecture.md` | 当前系统地图 |
| `subsystems/` | 当前行为、责任和失败边界 |
| `cookbook/` | 可执行的开发、构建和故障操作 |
| `project-status.md` | 已有交付、验收范围与缺口 |
| `postmortem/` | 对应日期的证据，不能代替当前规范 |
| `.agents/notes/` | 方案原因，沿源码锚点或关键词查找 |
| `archive/`、既有大写文件及`adr/` | 历史规则、规划与验收，保留原路径 |

## 当前说明与历史证据

当前行为按子系统维护，执行步骤按操作指南维护；版本、字段和命令回到源码核对。验收报告记录对应日期的观察，后续进展由发布状态链接到新证据，不把单次通过解释为长期保证。

`docs/` 下既有的大写主题文档及 `docs/adr/` 是保留原路径的历史资料；`README.md` 和 `AGENTS.md` 是当前入口与规则。历史资料的阶段目标、预算、型号和命令只在原记录语境下成立；精确冻结清单见 [归档政策](archive/README.md)。
