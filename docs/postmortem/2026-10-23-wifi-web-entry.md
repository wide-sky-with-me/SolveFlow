# Mac3131补充Wi-Fi HTTPS入口

日期：2026-10-23。范围：用户明确允许在固定Wi-Fi地址新增随登录启动的3131入口，与原Tailnet入口共用当前应用及模型配置。不改应用代码、不重建容器、不调用付费模型。

## 原因与处理

截图为`192.168.100.84:3131`拒绝连接。实际新端口仅监听Tailnet，Wi-Fi地址没有监听；旧3130有LAN网关，3030在Mac上未见监听。枚举网卡确认地址位于en1，Mac本机访问Wi-Fi3131的curl退出7，Tailnet原入口200。

继续使用`20261022-pdf-capacity`发布，首页SHA256为`1aa10666b1ad74bca921334d742aa38b7464e1867b2e6e574bf8260c800d835d`，包含[此前多份PDF容量修复](2026-10-22-multi-copy-pdf-capacity.md)。本次只增加访问入口，没有重新构建应用。

首次自动审批拒绝持久化新增Wi-Fi监听，未执行远程变更；用户随后明确授权。新增`local.solveflow.web-preview-lan`用户LaunchAgent，RunAtLoad/KeepAlive开启，仅绑定该Wi-Fi IPv4；独立生成一年期IP SAN自签证书，私钥600、目录700，私钥未离开Mac。共用原3131回环上游，固定Host/Origin/fetch-site校验保持，未新增通配监听或改防火墙。取舍见[双入口决定](../../.agents/notes/implemented/architecture/2026-10-23-dual-private-web-entries.md)，维护见[部署指南](../cookbook/docker-web.md)。

## 失败与复测

证据位于权限700的`.runtime/mac-wifi-2026-10-23/`，不含私钥、题库或模型正文。

- `enable-wifi.log`退出1并自动停新入口：启动脚本用`current`软链接，Node实际模块路径不同，CLI未执行。`symlink-entry-check.log`确认同一路径进程退出0但无监听或输出。改用当前发布目录真实路径，原入口未停。
- `enable-wifi-retry.log`退出1并回退：Mac自带Python对该自签证书报告issuer验证失败。其差异原因未确定；本地OpenSSL验证IP与证书通过，Mac curl及生产Node固定公钥和IP验证200。诊断握手中临时不验链只读取证书元数据，不计作通过，未关闭正式入口校验。
- 随后从本轮保留配置恢复新label，使用真实发布路径启动。`verify.log`由生产Node24固定公钥及IP校验：Wi-Fi/Tailnet均200，入口摘要一致，三类伪造来源403，保留API404、并发16/16，私钥权限与双固定监听通过，模型调用/配置写入0。
- `client-direct.log`：当前Linux客户端到远程私网TLS连接超时，curl退出28；不将它记作远程Wi-Fi终端通过。
- `browser-smoke.log`退出0：隔离Chrome经本轮回环SSH SOCKS访问Mac的Wi-Fi地址，页面加载、入口摘要、HTTPS安全上下文、Web Locks及16/16设置通过，无页面异常、配置写入或模型调用。此测试允许自签证书，固定公钥验证由前项独立完成。
- `preservation.log`退出0：旧网关PID保持，三个容器健康且均在排查开始前启动，模型文件最后写入时间早于排查；新label运行，RunAtLoad/KeepAlive启用。仅保留新网关供用户访问，临时SOCKS及SSH主连接在验收后关闭。

文档变更执行`pnpm docs:check`，结果见`docs-final.log`；没有应用源码变更，不重跑应用构建或单测，也不把此前成绩累计为本次应用回归。

## 限制

未代替用户在实际Wi-Fi终端验收，未验证路由器客户端隔离、整机重启/重新登录或DHCP换址。自签证书需客户端确认或信任，使用完整HTTPS地址；新Origin有独立浏览器历史，原地址记录不自动迁移。
