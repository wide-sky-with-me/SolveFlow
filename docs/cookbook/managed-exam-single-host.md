# 中心考试单机 Docker 部署

本页说明[单机覆盖配置](../../infra/exam-web/compose.single-host.yaml)；通用模型、账号及迁移步骤见[运行指南](managed-exams.md)。部署只在明确授权的主机执行，不自动停止占用80/443的其他应用。

## 存储与网络

覆盖配置增加固定版本SeaweedFS，沿用应用现有HTTPS S3适配；没有开放公网文件直链，也没有放宽本地开发存储限制。S3、PostgreSQL、Redis只在内部网络通信。原画面、模型图及缩略图存于`storage_data`卷，元数据在`postgres_data`卷，两者必须一起备份。

内部S3使用独立CA签发的服务证书，SAN包含`s3.solveflow.internal`与`*.s3.solveflow.internal`，客户端通过`NODE_EXTRA_CA_CERTS`增加信任，禁止关闭TLS验证。S3证书和私钥须挂载在相同容器目录。证书过期前重新签发并重建存储容器；CA私钥不挂载到应用中。

应用公开`origin`仍使用正式HTTPS域名。网关固定为`172.31.248.2`，应用配置`trustedProxyCidrs`为`["172.31.248.2/32"]`；动态容器地址使用该子网后半段，避免抢占网关地址。部署前确认网段不冲突。API仅额外映射宿主回环3191，供内部验收。

## 私有配置

1. 复制[单机环境例](../../infra/exam-web/env.single-host.example)到私有目录，准备应用配置、S3身份及TLS文件。域名和数据库密码须与对应配置一致。
2. 应用配置中`storage.type`为`s3`，endpoint为`https://s3.solveflow.internal:8443`，region为`us-east-1`，bucket为`solveflow-private`。生成随机S3访问凭据，只给该桶的Read、Write、List及Admin权限，不创建匿名身份。容器启动会预建该私有桶。
3. 应用配置、S3身份文件及存储服务私钥保持0600，宿主所有者设为容器UID1000；不要假定部署用户也是UID1000，也不要通过放宽到0644修复权限。CA和服务证书可为0644。
4. 首次bootstrap仅创建管理员与SAT模板。其余账号从管理API创建，不复制本机演示库；初始化后移除私有配置的bootstrap明文密码。模型继续通过私有配置提供，前端没有模型密钥。

## 启动、更新与回退

从源码构建时执行`infra/exam-web/deploy.sh /absolute/private/deploy.env --single-host`。镜像独立出包时允许移动端补丁没有对应依赖，实际存在的补丁继续应用；不会改仓库锁文件或取消依赖补丁。

低资源服务器可在同架构主机构建，用`docker save`和SSH传输，校验SHA-256后`docker load`。后续Compose命令统一包含`--env-file <私有环境文件> -f infra/exam-web/compose.yaml -f infra/exam-web/compose.single-host.yaml`，不要误用默认项目操作其他容器。

替换已有站点时，先启动postgres/redis/storage，导出迁移前逻辑备份，运行migrate/bootstrap，再启动api/events并从回环验收。确认干净账号和存储权限后启动worker。停旧服务释放80/443，启动gateway；默认由Caddy申请及续期证书，数据保留在独立卷。HTTPS验收通过后再禁用旧服务和其旧续期定时器。

已有有效证书需要平移时，在环境文件设置`EXAM_TLS_DIR`和`EXAM_ACME_WEBROOT`，脚本会增加[已有证书覆盖配置](../../infra/exam-web/compose.existing-tls.yaml)。目录内提供`fullchain.pem`和`privkey.pem`，ACME路径单独映射，其他HTTP请求跳转HTTPS。复制原Certbot账户/谱系到私有`shared/certbot`，配套安装[续期脚本](../../infra/exam-web/renew.sh)和定时器；成功后强制重载网关，失败保留原证书。使用`--dry-run`验证；模拟可能等待Certbot随机延迟，不把“定时器已启用”视为续期通过。

切换失败则仅停止新gateway，重启旧服务恢复入口；保留新卷以便排查。更新前安排暂停写入的窗口，配套备份数据库与存储卷；回滚应用不回退已应用schema。不对部署实例使用`down -v`、reset或drop。

只更新浏览器时，可基于各入口现有镜像增加`dist/public`和浏览器清单层，校验server.mjs摘要未变，仅重建对应API，保留worker及数据服务。原HTTPS与HTTP试用API须分别保留各自服务端基线。记录镜像、Compose覆盖路径及资源摘要；本机部署标记`shared/frontend-release.json`指向当前前端回执。后续操作原发布目录时须带上该覆盖，或使用包含新前端的完整镜像，避免回退页面。

公网验收须从实际客户端网络进行；服务器回环或单一路径成功不足以证明可用。腾讯云大陆节点如返回备案阻断页，应核对主域名备案与腾讯云接入状态；证书链通过不能消除上游阻断。Apple访问证据见[排查记录](../postmortem/2026-11-04-apple-access-and-guide.md)；用户授权的并行HTTP试用入口与网关恢复步骤归[试用指南](managed-exam-http-trial.md)。

同机存储仍有单机故障风险；跨主机容灾、托管COS及真机负载需要另行验证。首次腾讯云发布与证书限制见[验收记录](../postmortem/2026-11-04-managed-exam-deployment.md)。
