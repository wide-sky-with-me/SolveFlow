# 双分支请求进展与客户端体验修复

日期：2026-11-09。

范围：`feat/public-photo-web` 基于 `ee17fcb` 的工作区及独立 `main` 工作树（基于 `5aa3c32`）。保留开始时已有54项修改；不把中心考试页面或数据库改动合入main。本轮只在本地修改，无提交、推送、部署或付费模型调用。

## 变更与处理

共用解题器增加首内容与连续停滞保护，只用原有一次接手机会；实际派发前不计首响应，工具执行不计连续停滞。保留推理保护、阶段预算、取消优先与迟到结果隔离；响应头、首内容和失败原因分别记录。取舍见[决策](../../.agents/notes/implemented/agent/2026-11-09-model-progress-timeouts.md)，运行语义归[传输说明](../subsystems/model-transport.md)。

中心考试工作进程单独修复：阶段取消可打断等待并发名额；调用账本写入固定错误码，重复结算不覆盖终态；响应流结束、异常及取消释放读取器。集成发现SDK会替换abort原因，现按可信阶段诊断保存每次调用独立的分类，避免备用接手被旧结算误标。

客户端两边均将秒表显示从250毫秒改为每秒，隐藏/后台释放显示定时器，恢复时按墙钟补齐；块公式相同输入复用，提示关闭目标扩大到44逻辑像素。保留现有主题、分页缓动及减少动态效果，不另建动效系统。

## 验证结果

Node 24.19.0、pnpm 11.7.0；只用合成题和`.invalid`模型夹具。原始日志在当前工作区忽略目录`.runtime/dual-branch-optimization-20261109/`，不含真实模型正文或凭据。

- 当前分支完整Pi离线回归：`pnpm exec vitest run --project offline --maxWorkers=2 packages/agent/src/pi`，36文件426项通过，退出0。首轮受沙箱回环限制且发现新增日志事件混用；拆分事件后在允许回环的环境复测通过，原断言保留。
- 隔离PostgreSQL回归：`run-focused.mjs managed.integration.test.ts 'progress:'`，4项通过，退出0。覆盖首响应/部分输出超时、HTTP503原有重试、账本幂等和名额等待取消。首次测试字段误写为`model`，修正为真实`model_name`；随后发现SDK原因丢失并修复，失败日志保留。

- main相同Pi命令：36文件423项通过，退出0；差额来自分支原有测试，未移植无关JSON规范化。最后把超时异常改为通用Error，避免新增原生DOMException依赖，并增加空内容帧回归；两边最终定向5文件37项均通过，退出0。
- 两边客户端单元：秒表与公式入口2文件7项，以及公式释放、LocalEngine和设置契约3文件65项均通过，退出0。保留后台无显示刷新、前台补齐和销毁释放断言。
- main浏览器：`SOLVEFLOW_TEST_WEB_URL=<自有回环地址> pnpm exec playwright test`运行`overall-stopwatch`、`theme`、`responsive-ui`、`motion-experience`、`math-rendering`、`knowledge-math`和`conversation-math`七份spec，桌面/触屏26项通过；`batch-materials`的真实计时提示场景2项通过，退出0。仅相同布局的2项为留存截图复测，不累计为新样本。检查320/390/1100/1280/1920宽度、短横屏、主题切换、减少动态效果、跨页/刷新计时、隐藏120秒补齐及44像素关闭操作。人工复核窄屏暗色与桌面亮色截图无横向溢出、顶部遮挡；未作真机逐帧指标声明。
- main的`pnpm build:workspace`、两边根及mobile类型检查通过，退出0；main最终独立Web导出、当前分支共同包与exam-web构建通过。当前workspace整建曾因新夹具误写`run.id`失败，改为实际`runId`后定向exam-web构建复测通过。两边`pnpm lint`含源码边界与文档检查，`git diff --check`通过；新增文档曾超长/链接层级错误，精简修正后通过，未提高门槛或修改冻结文件。本轮新回归首次展示了静默与保活保护缺失，修复前4失败、1通过；不是用旧版通过成绩证明当前版本。

## 未验证项与剩余风险

未访问或替换腾讯云、远程Mac，未验证iPhone/Android真机、Safari或真实供应商耗时与准确率。90秒首响应阈值可能提前接手罕见的慢成功请求，不能承诺所有慢题都在该时间内完成。

main工作树初次安装受到包缓存缺失与注册表超时阻断；核对全部共同lockfile importer一致后，复制已有依赖及各包的相对workspace链接，构建生成main自己的dist。共同importer、补丁配置及补丁正文逐项一致；临时将pnpm的运行前自动重装设为warn，保留路径元数据告警，无清单、锁文件或检查阈值变更；此验证不等于干净联网安装验收。自有回环服务已停止，测试容器由finally清理；两边修改保留供审阅。
