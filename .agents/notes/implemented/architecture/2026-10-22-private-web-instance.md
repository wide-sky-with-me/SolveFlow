# 私有 Web 独立实例与并发默认值

日期：2026-10-22。状态：implemented。范围：容器部署、Tailnet HTTPS、实例并发。

## 背景

用户要求在已有远程 Mac 上保留旧服务，使用新端口发布当前工作树并提高并发。实机已有健康的旧容器与 LAN 网关，Tailnet Serve 未配置且没有可签发域名。浏览器执行队列沿本地偏好控制并发，单独提高代理容量不会增加答题吞吐。

## 决定

[容器入口](../../../../scripts/web-container.mjs)用共享 schema 校验可选实例并发，再通过 bootstrap 给未保存偏好的浏览器初始化；[模型配置器](../../../../scripts/web-model-settings.mjs)在加载、编辑、切换预设时保留启动默认。范围继续为每角色 1–32，不修改全平台默认或已有浏览器偏好。

[Compose](../../../../infra/web/compose.yaml)保留回环发布。[镜像](../../../../infra/web/Dockerfile)将白名单应用文件设为可读取，避免宿主私有 umask 令非 root 运行用户启动失败；挂载的凭据不在该权限调整范围内。新实例使用独立项目名、state 副本、端口、TLS 与 launchd label。[HTTPS 网关](../../../../scripts/web-lan-gateway.mjs)仅在显式开关下额外允许固定 100.64/10 IPv4，Host/Origin/fetch-site 校验及固定回环上游沿用旧边界；入口访问由既有 Tailnet ACL 控制。

## 放弃的方案

不覆盖旧服务或修改共享 state，避免回滚耦合及旧配置受到新实例写入影响。不提高全平台并发默认，以免影响已有设备；不只增加代理容量，因为队列仍受浏览器名额控制。不等待账户启用 Serve，使用已有 Node 与宿主 TLS；不开放通配或公网监听。

## 后果与限制

局部扩展[旧容器决策](2026-10-14-container-web-loopback.md)的地址范围，LAN 默认和旧实例保持原行为。并发 16/16 是本次实例配置，不承诺供应商吞吐或取消其限流。新 Origin 的 IndexedDB 独立，自签 TLS 需客户端确认或信任公钥；Tailnet 可达用户共用模型费用，不提供多租户隔离。

在上述地址与隔离约束下追加Wi-Fi入口的授权及部署见[双入口决定](2026-10-23-dual-private-web-entries.md)。

## 验证

[容器回归](../../../../scripts/web-container.test.mjs)覆盖合法/非法并发及模型持久化后默认保留；[网关回归](../../../../scripts/web-lan-gateway.test.mjs)覆盖显式地址准入和转发拒绝边界。远程部署与浏览器结果见[验收](../../../../docs/postmortem/2026-10-22-mac-web-deployment.md)；未验证整机重启、休眠与真实模型吞吐。
