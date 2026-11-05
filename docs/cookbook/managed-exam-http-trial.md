# 中心考试 HTTP 试用入口

仅用于用户明确授权的临时测试。默认入口仍要求HTTPS；HTTP中的登录和题图没有传输加密，也不能替代大陆节点的备案要求。身份及数据边界归[运行语义](../subsystems/managed-exams.md)，原HTTPS部署见[单机指南](managed-exam-single-host.md)。

## 前提与配置

1. 确认指定高位端口未占用且安全组已放行；不复用已有网站端口。已有中心考试项目的数据库、存储、worker和events须健康，不运行第二套迁移或初始化。
2. 从受保护的应用配置复制独立试用配置，保留数据库、Redis、模型及私有S3参数；仅改`origin`为`http://<IPv4>:<端口>`、加入`insecureHttpTrial=true`和必要的`httpTrialAliases`，如`["http://exam.example.com"]`。别名必须是完整、精确的HTTP来源，限默认80或主试用端口，禁止通配。配置0600且容器UID1000可读；不要修改主HTTPS配置。
3. 需要默认80端口域名入口时，保留网关的可信代理IP配置；直连IP请求仍忽略不可信转发头。私有S3、模型端点与服务端凭据继续走原保护，不因浏览器用HTTP而放宽。

独立环境文件只填写`EXAM_HTTP_TRIAL_RELEASE`、`EXAM_HTTP_TRIAL_PORT`、`EXAM_HTTP_TRIAL_CONFIG_FILE`与`EXAM_STORAGE_CA_FILE`。前两项对应已校验镜像标签及指定端口；后两项是宿主绝对路径。环境文件不公开，不能把完整模型配置放入前端。

## 启动与默认端口域名

执行`docker compose --env-file <试用环境文件> -f infra/exam-web/compose.http-trial.yaml up -d --wait`。此[覆盖文件](../../infra/exam-web/compose.http-trial.yaml)属于独立`solveflow-http-trial`项目，只启动`http-trial-api`，连接既有两个外部网络。服务名称避免使用`api`，防止其网络别名与原HTTPS后端冲突。它共享原PG/Redis/存储和任务worker，不复制账号或题图。

域名不带端口的HTTP使用80。将[试用网关文件](../../infra/exam-web/Caddyfile.http-trial)放到独立受控路径，在原项目标准Compose、单机和已有TLS三份配置之后，叠加[网关覆盖](../../infra/exam-web/compose.http-trial-gateway.yaml)，设置`EXAM_HTTP_TRIAL_CADDY_FILE`为其绝对路径，仅更新gateway。HTTP普通请求转入`http-trial-api:3190`，ACME路径保留；HTTPS依旧转入原`api:3190`。验证网关配置后再切换；不停止其他应用或重建数据库/存储。

## 验收与停止

分别验证IP高位端口及`http://域名/`，检查重定向、页面资源、登录、图片预览及教师同步；公网、远程Mac与隔离浏览器分开报告。HTTP试用Cookie名为`solveflow_exam_http_trial`，不接收原HTTPS Cookie。两个主机首次登录分别进行，账号及考试数据仍共享。HTTP下请求标识采用getRandomValues；没有安全随机数时明确失败，不退化为Math.random。

域名若被云平台备案拦截，修改网关不能解除上游阻断。浏览器可能优先HTTPS或沿用旧HSTS；应明确输入HTTP地址，不能把服务器回环200当作手机公网已通。保留原HTTPS加密和证书检查，不自动替用户清除浏览器安全设置。

停止时先用原三份Compose恢复gateway，确认HTTP恢复原HTTPS跳转，再停止独立试用项目；外部网络及数据卷不删除。后续更新原项目须明确是否继续叠加试用网关，避免无意取消或遗留入口。

## 当前腾讯云入口

截至2026-11-05，临时入口为`http://110.40.227.224:18443/`；原域名的HTTP默认80入口为`http://solveflow.widesky.top/`。显式输入`http://`，两处均沿用原账号和考试数据。原HTTPS入口与主配置保留。

IP入口已从本机Chrome/WebKit及远程Mac系统WebKit验证登录和教师实时连接。域名入口本机验证通过，远程Mac仍返回腾讯云备案阻断跳转；遇到这种情况使用IP测试并处理备案接入，不能宣称域名已全网恢复。HTTP为明文临时测试，iPhone真实相机仍需实际设备验收。

取舍见[决策](../../.agents/notes/implemented/architecture/2026-11-05-http-ip-trial.md)；本轮实际测试、部署与公网结果见[验收](../postmortem/2026-11-05-http-ip-trial.md)。
