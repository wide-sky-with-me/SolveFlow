# 学生端模拟提示调整

日期：2026-11-05。范围：`feat/public-photo-web`工作区的学生端展示；未提交，后续按用户授权发布腾讯云。

## 变更

按用户要求，学生考试页移除全场“错题模拟”，最近答案和题目详情移除模拟答案徽标；不以“待核验”或“AI已核验”替代该提示。正常AI答案及人工答案仍按实际状态显示。

教师端仍显示模拟标记、学生当前答案与AI原始结果。未改协议、错题选取、替代答案、核验状态或数据库；学生仅展示已经发布的答案。当前边界归[答案展示](../subsystems/managed-exam-answers.md#错题模拟)。

## 验证

新增Chrome/WebKit两个隔离浏览器场景：修改前均在学生仍出现两处模拟文字的断言失败；修改后均通过。检查最近选项和详情答案可见、模拟文字与核验徽标均不出现、教师仍看到模拟标记及原始答案，页面无横向溢出或JS错误。截图实际查看了学生详情页，未见空徽标残留。

另执行既有学生/教师两端的原图与详情回归，Chrome/WebKit四项通过。使用随机隔离PostgreSQL、合成题及假模型，没有访问正式考试或调用付费模型；临时容器由运行器清理。

定向执行使用`vitest.integration.config.ts`与`managed.integration.test.ts`，测试名分别为`console: student simulation labels`和`console: question dialogs and original image controls`。`pnpm --filter @solveflow/exam-web build`退出0。源码边界检查通过；首次文档检查发现平台总览超8个文档单位，精简所属链接说明后复查，不放宽上限。

本轮只验证上述六项交互与构建，不沿用上轮129项成绩作为本次全量验收；真机及真实模型本轮未验。腾讯云发布范围见下节。

## 腾讯云发布

前端版本`20261105-student-labels`，浏览器入口`main-HTKIY3XP.js`。HTTPS API基于原`20261104-progressive-images`镜像增加前端层，HTTP API基于原`20261105-http-trial`增加相同前端；分别为`solveflow/exam-web:20261105-student-labels`及`solveflow/exam-web:20261105-student-labels-http`。

两份server.mjs摘要与各自原镜像一致，私有配置摘要和schema7保持。只重建两个API；部署前后比对确认worker、events、gateway、数据库、Redis、对象存储及其他站点容器ID和启动时间均不变。没有迁移、初始化、清理考试或发起模型调用。

镜像、资源摘要与独立Compose覆盖保存在服务器发布目录，`shared/frontend-release.json`记录当前前端覆盖位置；原current仍指向后端基线。失败恢复原API镜像，不回退数据；后续维护见[部署指南](../cookbook/managed-exam-single-host.md)。回环18443、域名80及HTTPS API的HTML/JS摘要符合发布包，两个API健康，严格TLS域名443健康检查200。

从本机公网访问IP18443、HTTP域名默认80和HTTPS域名443，首页均200，HTML及JS摘要与发布包一致。Chrome三类账号登录/退出、教师WS和学生文件相机入口通过；WebKit管理员通过，但首轮教师详情等待30秒超时，截图停留“正在同步学生进度”。保留该失败，未放宽超时。

定向复查WebKit教师及学生两项通过：教师快照117–158毫秒、WS正常，学生相机文件入口正常，全部退出会话。数据库聚合状态无锁等待，首轮没有网络跟踪，不能据复测成功断言首次超时根因。公网未选题图、不改考试、不调用模型；临时凭据已删除。Mac/iPhone及其他网络本轮未重测，既有域名部分网络备案阻断仍按[访问验收](2026-11-05-http-ip-trial.md)处理。
