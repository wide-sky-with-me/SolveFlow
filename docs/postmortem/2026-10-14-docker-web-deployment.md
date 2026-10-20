# Docker Web 远程部署验收

日期：2026-10-14。范围：feat/batch-pdf-unified 当前工作树 Web、模型迁移及同 Wi-Fi 入口。

## 结论

目标 mac@100.88.228.28 是 macOS arm64，已有非默认 PEM 登录成功。Colima Docker 29.5.2、Compose 5.6.0 和开机服务已存在。SolveFlow 容器使用 Node 24.19.0 固定多架构摘要、501:20、只读根目录、回环端口 3130及 unless-stopped；已有 PersonaWeave 不变。

局域网直达为 https://192.168.100.84:3130，Mac Wi-Fi en1，本机 WLAN 地址同网段。宿主薄网关由 local.solveflow.web-lan launchd 用户任务维护，仅监听该私有 IP；应用及模型仍在 Docker。自签证书 SAN 为该 IP，首次访问需确认；未安装客户端信任根，未启用 Serve/Funnel。

## 数据与版本

应用保存于目标用户 `.local/share/solveflow-web/releases/20261014-b9044c2`，current 指向该版；网关是独立 `gateways/20261014-lan-tls`。shared/state 保存三角色及两个预设，目录 700、JSON 600；迁移前后和容器重启后 SHA256 一致。TLS 私钥独立留在宿主，状态和密钥未装入镜像。验收前私有备份保留。

来源为本地 Web 启动引用的持久化配置与 .env；3100 活动入口读取超时，未核对其进程内存。未重启或替换原体验入口，未迁移题库、原题图和浏览器 profile。入口改变产生独立 IndexedDB。

## 验证

- `pnpm test:web-container`：十项通过，涵盖模型状态、密钥隔离、启动无调用、保存、固定回环转发与 Host/Origin 负向边界。镜像本地构建、目标 arm64 实际构建成功。
- SSH 与 LAN 浏览器使用隔离 Chromium；LAN HTTPS HTTP 200、secureContext 与相机 API 存在、模型设置可读、无 pageerror/配置写入/模型调用。自签测试显式允许此目标的证书异常；另以实际公钥证书验证链与 IP，HTTP 200。
- 三角色真实连接显式 live 各一次，均 200，单次输出上限 256、不存正文；不是原题正确率验收。LAN HTTPS 另以未配置模型验证 POST 已到模型校验而不派发上游，外来 Origin 为 403，无新增付费请求。
- Docker restart 后重新创建为 healthy、配置不变；launchd 网关 restart 后再验收页面。未重启整台 Mac 或 Docker daemon，未验休眠恢复及真实摄像硬件。
- 新脚本后 lint、docs:test 通过；最终文档与差异检查单独记录于本次 runtime 目录，不引用旧 PDF 成绩。

## 失败与调整

默认密钥认证失败，经用户指出后找到已有 PEM。夹具额度低于共享契约下限，修正后复测；fetch 的伪造 Host 未送出，改用原始 HTTP 保留断言。初次模型探针缺 schemaVersion，校验 400 且无派发；共享 schema 预检后真实连接通过。失败证据保留。

Tailscale Serve 尚未启用；用户明确仅同 Wi-Fi，因此结束等待。普通 LAN HTTP 虽200，应用被 Web Locks 门槛阻止启动；没有删锁或放宽数据保护，增加自签 LAN HTTPS 后浏览器通过。Colima 实测只转发宿主回环，不改其全局网络或重启其他容器。

## 维护

这是首次部署，无旧远端版本。撤回仅停本项目网关与容器，保留状态、备份及镜像。固定 Wi-Fi IP 改变须同步 launchd 参数和证书 SAN；证书有效至2027-10-14。临时 SSH 隧道及 HTTPS 账户等待已清理。边界和操作见[Docker 指南](../cookbook/docker-web.md)。
