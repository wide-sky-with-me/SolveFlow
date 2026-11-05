# 中心考试平台第一阶段验收

日期：2026-11-02至2026-11-03。

范围：`feat/public-photo-web`未提交工作区；Node24.19.0、pnpm11.7.0、临时PostgreSQL17.9、Linux Chrome。题图和模型结果均合成，真实付费调用0。

结论：中心身份、模块/题位、版本、任务和双端界面已进入真实API/事务实现；当前不代表生产可用。完整范围见[当前语义](../subsystems/managed-exams.md)。

## 变更与处理

新增独立exam-web、`exam_app`迁移及参数化事务；已有公网单题页仍独立运行，共用主题、图标和富文本。固定题位在答案提交后推进，补图重答不移动主游标，任务与浏览器连接分离。

首轮9项集成中5项失败，根因是合成结果未声明共享契约要求的未请求核验状态，随后依赖前置结果的测试跟着失败；补全夹具，未放宽契约。

首次浏览器流程超时；缩小单动作等待并记录页面错误后发现共享TSX按经典方式构建，报`React is not defined`。新增共享包JSX配置并在两个浏览器构建显式使用自动运行方式；随后13项集成含完整浏览器流程通过。最终增至16项，覆盖并发版本、管理端操作、旧库升级、打包入口及真实Agent经假传输调用。浏览器还注入一次存储失败，确认保留图片并可重试；提交幂等键不变化，不重复创建模型任务。

## 验证结果

以下均为本次实际命令，不将重复复测累加为新样本：

| 命令 | 结果与范围 |
| --- | --- |
| `pnpm --filter @solveflow/contracts build`、`pnpm --filter @solveflow/db build`、`pnpm --filter @solveflow/exam-web build` | 各退出0；新契约、DB及浏览器/Node产物 |
| `pnpm exec tsc --noEmit` | 退出0；根TypeScript检查 |
| `pnpm exec vitest run --project unit packages/contracts/src/managed-exam.test.ts --maxWorkers=2` | 3项通过，退出0；归属注入、图片列表、模块、时间及角色边界 |
| `node scripts/test-managed-exams.mjs --image=postgres:17.9-alpine3.23` | 最终16项通过，退出0，11.83秒；真实PG/HTTP/WS及Chrome，全部合成模型响应 |
| `pnpm --filter @solveflow/photo-web build`、`node scripts/test-photo-web.mjs` | 各退出0；旧入口10项浏览器回归通过，26.3秒 |
| `docker compose --env-file infra/exam-web/env.example -f infra/exam-web/compose.yaml config --quiet`、`sh -n infra/exam-web/deploy.sh` | 退出0；配置/语法，不等同镜像构建或部署 |
| `pnpm lint`、`git diff --check` | 退出0；源码边界、当前文档/笔记及差异检查 |
| `pnpm docs:test` | 20项通过，退出0；首次沙盒禁止CLI子进程`spawnSync EPERM`，获准按原命令复测后通过 |

集成覆盖：0002旧数据保留升级到0003、owner/支持范围、时间/未来题禁拍、幂等冲突与并发版本、补图/旧回调、重复取消、过期租约不复活、额度/名额、顺序事件、身份撤销、模块解锁、模拟结果隔离与原始记录防覆盖、孤儿图回收、打包迁移/初始化、手机视口与管理端创建用户。

真实Agent流程通过注入假传输完成solver/verifier两次调用及名额释放，没有访问供应商。图片为纯合成图，不能作为识别准确度证据。临时PG只映射回环随机端口、使用内存盘，结束删除；截图及首次失败记录在忽略目录`.runtime/managed-exams-browser`。

`pnpm audit --audit-level=low`退出1，仍报既有2中危、1低危：[minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249)、[glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)、[deepmerge](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)，主要报告路径为Expo依赖。本轮未更改这些版本；审计不记为通过。

## 未验证项与剩余风险

真实模型/题图、COS实际策略与兼容、12用户真实负载、容器完整构建、恢复及远程部署未执行。SQL建表及合成事务通过不证明所有生产边界。AI分数规划、参考表和结构化数据完整保留/删除流程尚未实现；固定角色不等同自定义权限平台。
