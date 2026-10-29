# Docker 网页端部署

## 范围

应用在 Docker 运行，题库仍归浏览器。模型凭据留在独立私有状态；不需要历史 API/Postgres。Docker 只发布宿主回环，局域网用宿主固定地址 HTTPS 网关，网络边界原因见[决策](../../.agents/notes/implemented/architecture/2026-10-14-container-web-loopback.md)。同网段入口可达的设备共用该模型配置，不作为公网多人服务。

## 发布与模型

根目录执行 `pnpm package:web`，重建当前工作树并产生不可覆盖的发布目录。清单记录应用包和宿主网关摘要；Docker 只复制白名单应用文件，gateway 在宿主运行。新版本使用新的目录，不改旧包。

`node scripts/export-web-models.mjs PRIVATE_STATE_DIR` 只导出当前 Web 启动引用的三个模型角色及预设，单独通过 SSH 传输。日志标明活动配置核对是否完成；服务超时采用持久化源，不声称与进程内存一致。不要将私有目录装入镜像或提交仓库。

## 运行与入口

目标 state 目录模式 700、JSON 600，Compose user 与 owner 一致。变量清单见[Compose](../../infra/web/compose.yaml)。执行 `docker compose --env-file COMPOSE_ENV -f compose.yaml up -d --build --wait`，核对平台、健康、回环发布、配置文件权限及重启保留。

每个实例可用 `SOLVEFLOW_WEB_SOLVER_CONCURRENCY` 和 `SOLVEFLOW_WEB_VERIFIER_CONCURRENCY` 设置首次访问的答题/校验并发，范围沿用共享契约；未配置时保留原默认。浏览器已保存的并发优先，修改模型或切换预设不重置该实例默认，也不将它写入模型文件。

macOS Colima 的回环转发保持原样。宿主用已有 Node 运行 gateway.mjs，经独立 launchd 用户任务维护。`SOLVEFLOW_LAN_ADDRESS/PORT` 为固定私有 IPv4 和端口；TLS key/cert 路径由 `SOLVEFLOW_LAN_TLS_KEY/CERT` 指定。证书 SAN 必须含实际 IP，TLS 私钥留在 700 私有目录内、文件 600。网关仅监听该地址，转发目标不可由请求选择。

浏览器第一次访问自签 HTTPS 时确认此证书，或导入该部署的公钥证书；不传 TLS 私钥。普通 LAN HTTP 不满足 Web Locks、Web Crypto 和相机所需上下文，不通过删除应用锁规避。更换 DHCP 地址后更新 launchd 参数与证书 SAN；可在路由器为该机器保留地址。

默认不启用 Tailscale Serve/Funnel；可选私有 Serve 需要账户已启用并固定 HTTPS origin。不要同时新增公开监听。新访问地址有独立 IndexedDB，旧题库不自动迁移。启动、刷新与重启不重放付费请求。

账户未启用 Serve 时，可设置 `SOLVEFLOW_LAN_TAILNET=true`，将同一 HTTPS 网关绑定到本机固定的 Tailscale IPv4；仅额外允许 `100.64.0.0/10`，仍拒绝通配或公网地址并检查精确 Host/Origin。证书 SAN 使用实际 Tailnet IP。此开关不创建身份认证，访问权依赖 Tailnet ACL；详见[独立实例决策](../../.agents/notes/implemented/architecture/2026-10-22-private-web-instance.md)。

同一实例同时供 Wi-Fi 与 Tailnet 访问时，每个固定地址使用独立网关、launchd label 和匹配 SAN 的证书，均转发同一回环端口。新增入口须获得对应访问范围的授权。启动参数使用发布目录真实绝对路径：网关 CLI 按入口路径执行，版本软链接可能令进程空退出。应用和模型配置共用，各 Origin 历史独立；撤回只停止目标入口，见[双入口决策](../../.agents/notes/implemented/architecture/2026-10-23-dual-private-web-entries.md)。

## 维护与撤回

升级前备份 shared/state，模式仍为 700/600；保留旧镜像、发布清单、网关和 launchd 配置。只操作本项目的 Compose 和 launchd label，不重启整个 Colima。

macOS 重载网关时，bootout 后等待本 label 不再可查询且旧 PID 已退出，再 bootstrap；立即重载可能返回 EIO。失败时恢复旧 plist 和该实例容器，不修改模型状态。

需要并行保留旧版本时，另建发布目录和私有 state 副本，使用新端口、独立 `docker compose -p PROJECT` 与 launchd label；不要沿用旧 Compose 项目名、共享可写模型状态或覆盖旧网关。新实例从现有私有模型配置初始化，后续设置各自保存。

回滚应用至已保留的旧镜像；网关回滚后重新 bootstrap 本 label，保留 shared 状态。首次部署无旧版时，撤回仅 bootout 本网关、Compose down，不带 -v、不删状态和浏览器记录。容器、网关重启与整机休眠/重启分别验收。
