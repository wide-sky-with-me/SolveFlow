# 答案配色与五态总览腾讯云更新

日期：2026-11-06。

范围：`feat/public-photo-web`工作区的中心考试前端；腾讯云原域名与HTTP试用入口。沿用[上一版后端](2026-11-06-student-controls-deployment.md)，未更新main或Mac。

结论：`20261106-status-palette`已发布，两个API健康。三公网入口的首页、JS摘要及health通过，Chrome/WebKit三角色共六组登录/退出通过；教师导航五态图例和当前题蓝色高亮生效。

## 变更与保护

[学生答题展示](../subsystems/managed-student-flow.md)增加浅绿/浅黄答案标牌，学生总览与教师导航共用未答、正在回答、校验、通过、出错五态；当前题单独蓝色高亮，保留问题标记。人工确认和AI核验来源仍分开。小屏题格加宽，避免“正在回答”挤出。

发布前、备份后均检查活动任务及45秒在线人数为0。基于原镜像只替换`dist/public`和浏览器清单，两API的server.mjs摘要保持`6950cc8511c509a713ffa12e5d175ff6f885c9fb629cdd6578e4741f41a2474a`。worker/events、网关、数据库、Redis、对象存储及其他站点容器ID和启动时间不变；业务表计数、配置摘要及schema7不变，未重置账号或修改考试数据。

发布镜像`solveflow/exam-web:20261106-status-palette`，ID为`sha256:2b77d85c894b3774c1857306fc8f0beab1f6632c302630e9cdecfddd1474484c`；页面入口`main-BBBCHIDZ.js`。产物84份、压缩包3878446字节，SHA-256为`278c17b56ee646e90c370478b5c1c917ecca1514a1379ee7e808d46017df95ce`。PG备份516410字节，已检查pg_restore目录，未演练恢复。

服务器`shared/frontend-release.json`登记本次浏览器覆盖与回执；旧覆盖保留用于回退。后续更新需遵循[单机指南](../cookbook/managed-exam-single-host.md)，避免遗漏覆盖而回退页面。

## 验证结果

本次证据位于忽略目录`.runtime/status-palette-20261106/`。

- 新增回归在Chrome/WebKit首先复现旧黄底错误（`red-2.log`）；最初测试启动因默认镜像标签未安装失败，改用已有PG17.11镜像，未拉取替代镜像。
- 隔离PG及合成快照回归18项通过（`regression.log`），最终修改后的相关8项子集复测通过（`final-regression.log`），不重复累计。覆盖旧答案不能遮盖重答/失败、待处理解除、人工确认、未核验展示、停止、跳过及切题。运行命令为`SOLVEFLOW_STATUS_TEST_PATTERN=… node .runtime/status-palette-20261106/test.mjs --image=postgres:17.11-alpine3.23`，两轮退出0；脚本使用项目原有隔离测试流程和180秒上限。
- `pnpm --filter @solveflow/exam-web build`、`pnpm exec tsc --noEmit`、`pnpm lint`及`git diff --check`退出0。手工查看320/390手机和1440教师截图，明暗主题文字无挤出；视口不代表真机。
- 部署脚本退出0；镜像无网络自检确认后端摘要不变。公网IP18443、HTTP域名80、HTTPS域名443的资源/health一致（`deployment/public-assets.json`）。
- 公网Chrome/WebKit既有管理员、老师、学生账号登录/退出通过；教师五态图例、蓝色选中、内嵌导航、居中计时和手动表单取消正常，学生头像记录及Logo首页正常（`deployment/public-smoke.json`）。除登录/退出外阻止所有写入，没有付费调用；学生账号没有分配考试，实际逐题配色由隔离快照验证。
- 临时凭据和上传目录已删除，私有截图与部署回执保留；没有把真实题图、密码或模型原文写入文档。

## 限制

未测试iPhone/macOS真机、其他网络、真实答题耗时或模型正确率。原有部分网络域名阻断和结束提示偶发延迟沿[上一轮](2026-11-06-student-controls-deployment.md)追踪；本次不修改模型等待和并发策略。
