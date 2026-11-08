# 学生顶栏与重答接口腾讯云更新

日期：2026-11-06。

范围：用户此前授权的腾讯云中心考试部署，发布`feat/public-photo-web`工作区。只更新两个API及配套contracts/db产物和页面，不提交代码或更新main/Mac。

结论：`20261106-student-controls`已发布，入口`main-SVFAFDXJ.js`，两个API健康；公网三入口资源一致，Chrome/WebKit三角色共六组登录/退出通过，学生头像记录和Logo首页可用。没有发起模型调用、上传新题图、重置密码或修改考试内容。

## 发布范围与保护

本次包含[顶栏精简和学生原材料重答](2026-11-06-student-header-rerun.md)。不能仅换静态页面：学生入口需要新增HTTP路由、共享契约及本人题位事务，故发布完整应用/契约/db编译层。worker继续识别原普通学生solve任务，无新增schema或工作人员权限。

最初观察到一个在线会话、活动任务0；准备产物后复查为无人在线、活动任务0，发布脚本在备份后再次检查空闲。PG备份514940字节，经pg_restore目录检查，未做恢复演练。两API滚动替换，worker/events、网关、数据库、Redis、存储和其他站点容器ID/启动时间不变；配置摘要、schema7和业务表计数前后相同，账号保持14个。

镜像`solveflow/exam-web:20261106-student-controls`，ID`sha256:4d088d74e279c3cf2f1a914c58112e67be8c7bd633412346525c0af58ad14d42`。源基线`62572c2b3e8f`带未提交修改，源清单501份、编译清单231份；传输包4636290字节，SHA-256为`05a39bae28ccda5fe316940cd4142de1197fb795480eca749bf2c954aab56a6e`。

服务器发布目录保留旧覆盖回退入口及独立API/HTTP覆盖；`shared/frontend-release.json`更新为当前完整API回执。原current仍保留基础部署目录，后续Compose需带当前覆盖，见[单机指南](../cookbook/managed-exam-single-host.md)。

## 验证与限制

证据位于忽略目录`.runtime/student-toolbar-20261106/deployment/`。

- 本地构建、166项隔离回归、16项契约单元及截图见[本地验收](2026-11-06-student-header-rerun.md)，不将其计为公网真实题目测试。
- 部署脚本退出0，归档及逐文件摘要匹配；无网络镜像自检验证新studentRun导出、契约和路由、运行依赖及UI标记。新接口拒绝越权、窗口和旧版本的事务由隔离回归验证。
- 本机公网IP18443、HTTP域名80、HTTPS域名443的首页/JS摘要及health均通过（`public-assets.json`）；回环与严格TLS健康检查同样通过。
- 公网Chrome/WebKit分别使用既有管理员、老师及student01登录/退出，通过教师内嵌导航、居中计时、手动作答取消、学生头像记录和Logo回首页，无横溢出或JS错误（`public-smoke.log`）。阻止除登录/退出外的HTTP写入，不点击公网“重新解答”，不调用付费模型。
- 既有私有交付文件提供测试凭据，临时文件0600、值不打印。检查结束退出会话并删除临时凭据、上传目录；截图保持私有。原student/student2密码未调整。

未验证iPhone/macOS真机、其他运营商网络、真实重答耗时和模型正确率；既有备案路径限制、WebKit偶发结束提示延迟仍沿[前轮发布](2026-11-05-student-teacher-ui-deployment.md)追踪。没有改变主模型240秒等待、备用接手或8/8并发。
