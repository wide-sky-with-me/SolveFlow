# 容器发布保留 Web 回环模型边界

日期：2026-10-14。状态：implemented。范围：容器发布、局域网 HTTPS 与模型配置迁移。

## 背景

用户要求当前工作树部署到指定 Mac，保留现有模型；后续明确只需同 Wi-Fi 访问。[既有桥接](2026-10-08-local-web-environment.md)仅回环同源，没有公网身份或多用户费用隔离。实机为 macOS arm64、Colima；Docker 端口由宿主 SSH 转发仅监听回环。普通 LAN HTTP 实测被 Web Locks 门槛阻止启动，保留数据锁而采用局域网 HTTPS。

## 决定

[容器入口](../../../../scripts/web-container.mjs)复用既有服务、契约及原子存储，Docker 只发布回环。[LAN 网关](../../../../scripts/web-lan-gateway.mjs)在宿主指定私有 IPv4 上终结自签 TLS，经 launchd 管理；校验固定 Host、Origin 与 fetch-site。首页无 Origin 的 GET 文档导航可来自其他页面；仅该路径转为 `none`，使既有桥接接受正常链接打开；模型路径、写入、iframe 与外来 Origin 不享此例外。剥离转发头，转换到固定回环上游；保留取消、背压与阶段超时。模型/预设独立挂载，凭据不进镜像或浏览器；TLS 私钥留在宿主私有目录。

[发布器](../../../../scripts/package-web-container.mjs)复用已构建 Web 和受审服务器依赖，用既有 esbuild 打包，镜像不安装新的 Node 依赖，不带源码、题库、`.env` 或私有状态。原独立 Web CLI 在单文件合并时其主入口判定会变化，因此只在发布副本关闭该分支，原源码及本地体验服务不改。

## 放弃的方案

不放开模型桥接原本的 Host/Origin 校验，不启用历史 API/Postgres，不关闭浏览器本地任务锁。Tailscale Serve 需要账户启用，用户明确无需它，结束等待且未配置 Funnel。更改 Colima 全局网络或重启 VM 会影响已有容器，故增加使用已有 Node 的宿主薄网关，而非修改整个 Docker 宿主。

## 后果与限制

地址准入在[独立实例决策](2026-10-22-private-web-instance.md)中局部扩展：显式允许固定 Tailnet IPv4；原 LAN 默认与其他边界继续有效。

入口可达的局域网设备共用服务器模型，不提供多租户或费用身份隔离。自签证书需要首次确认或导入公钥证书；地址变更需同步证书 SAN 和 launchd 参数。新地址拥有独立 IndexedDB。整机重启/休眠未验；迁移来自原持久化模型文件，本地 3100 读取超时，未证明与其进程内存完全一致。

## 验证

[容器测试](../../../../scripts/web-container.test.mjs)与[网关测试](../../../../scripts/web-lan-gateway.test.mjs)覆盖状态、密钥、原子保存、固定回环转发与负向边界；本次浏览器、连接和重启证据见[验收](../../../../docs/postmortem/2026-10-14-docker-web-deployment.md)。
